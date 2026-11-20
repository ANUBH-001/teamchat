// Voice-note recorder state machine (hardening R-05 / R-02). Plain TypeScript, no React: useVoiceRecorder (VoiceRecorder.tsx)
// subscribes to it. Rules:
// - every start gets a sequence id; a start that resolves after it was cancelled / timed out / unmounted is disposed, never used
// - the UI goes to idle synchronously on every exit path (send, cancel, slide, trash, error, watchdog, background, unmount);
//   the native stop / unload runs afterwards and can never block the next press
// - one idempotent teardown() clears timers; dispose() unloads a recording at most once and deletes discarded files
// - the timer comes from the clock (now - t0 - paused total) in a 100 ms interval, levels from the last metering value
//   (fallback animation when the device gives no metering)
// - lock only while really recording; < MIN_MS = discarded (onShort); MAX_MS = auto-send with a countdown hint before it
// - permission is asked once; a press without permission only asks (does not start recording)
import { Audio } from 'expo-av';
import { Platform } from 'react-native';

export type Phase = 'idle' | 'starting' | 'rec' | 'locked';
export type VoiceResult = { uri: string; durationMs: number; waveform: number[] };
export type Snapshot = { phase: Phase; paused: boolean; ms: number; levels: number[]; leftMs: number | null };
export type EngineCallbacks = {
  onDone: (r: VoiceResult) => void;
  onShort: () => void;
  onError: (msg: string) => void;
  onNotice?: (msg: string) => void;
};

// The slice of expo-av the engine uses (tests pass a controllable fake).
export type RecordingLike = {
  setProgressUpdateInterval(ms: number): void;
  setOnRecordingStatusUpdate(cb: ((s: Audio.RecordingStatus) => void) | null): void;
  prepareToRecordAsync(o: Audio.RecordingOptions): Promise<unknown>;
  startAsync(): Promise<unknown>;
  pauseAsync(): Promise<unknown>;
  getStatusAsync(): Promise<Audio.RecordingStatus>;
  stopAndUnloadAsync(): Promise<unknown>;
  getURI(): string | null;
};
export type AudioLike = {
  getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  setAudioModeAsync(m: Parameters<typeof Audio.setAudioModeAsync>[0]): Promise<void>;
  newRecording(): RecordingLike;
};
export type EngineDeps = { audio?: AudioLike; now?: () => number; deleteFile?: (uri: string) => Promise<void>; os?: string };

export const MIN_MS = 1000;
export const MAX_MS = 15 * 60 * 1000;
export const WARN_MS = 30 * 1000; // countdown hint in the last 30 s
export const START_TIMEOUT_MS = 3000;
export const TICK_MS = 100;
export const MSG = {
  denied: 'Mic ki permission nahi hai. Settings > Apps > TeamChat > Permissions mein Microphone allow karo',
  granted: 'Mic ready. Ab mic dabake rakho aur bolo',
  busy: 'Mic busy hai (call ya koi aur app). Thodi der baad try karo',
  watchdog: 'Mic start nahi hua, dobara try karo',
  failed: 'Recording nahi hui, dobara try karo',
  background: 'App band hui, recording hata di',
};

const HQ = Audio.RecordingOptionsPresets.HIGH_QUALITY;
// m4a AAC mono 64 kbps, metering on (live waveform + stored peaks)
export const OPTIONS: Audio.RecordingOptions = {
  ...HQ,
  isMeteringEnabled: true,
  keepAudioActiveHint: true,
  android: { ...HQ.android, extension: '.m4a', outputFormat: Audio.AndroidOutputFormat.MPEG_4, audioEncoder: Audio.AndroidAudioEncoder.AAC, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000 },
  ios: { ...HQ.ios, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000 },
};

// ~48 normalized peaks 0..1 from the raw 100 ms samples
export function peaks(samples: number[], n = 48): number[] {
  if (!samples.length) return Array(n).fill(0.1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * samples.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * samples.length) / n));
    out.push(Math.max(...samples.slice(a, b)));
  }
  const top = Math.max(...out, 0.2);
  return out.map((v) => Math.round(Math.max(0.08, Math.min(1, v / top)) * 100) / 100);
}

// dBFS (-160..0) -> 0..1; speech sits around -30..-10
export const levelOf = (db: number) => Math.max(0.05, Math.min(1, (db + 50) / 50));

export function micErrorText(e: any): string {
  const m = String(e?.message || e || '');
  if (/only one recording|already prepared|busy|in use|audio focus|start failed|-38/i.test(m)) return MSG.busy;
  if (/permission/i.test(m)) return MSG.denied;
  return MSG.failed;
}

const realAudio: AudioLike = {
  getPermissionsAsync: () => Audio.getPermissionsAsync(),
  requestPermissionsAsync: () => Audio.requestPermissionsAsync(),
  setAudioModeAsync: (m) => Audio.setAudioModeAsync(m),
  newRecording: () => new Audio.Recording() as unknown as RecordingLike,
};

// The last recording that may still hold the native recorder (expo-av allows one prepared recorder per app).
// A busy error on the next start first frees it and retries once.
let leaked: RecordingLike | null = null;

export class RecorderEngine {
  private audio: AudioLike;
  private now: () => number;
  private deleteFile: (uri: string) => Promise<void>;
  private os: string;
  private cb: EngineCallbacks;
  private listeners = new Set<() => void>();
  private snap: Snapshot = { phase: 'idle', paused: false, ms: 0, levels: [], leftMs: null };
  private seq = 0;
  private rec: RecordingLike | null = null;
  private pending: RecordingLike | null = null; // being prepared / started
  private disposed = new WeakSet<object>();
  private prepared = new WeakSet<object>(); // prepareToRecordAsync resolved (only then can it be unloaded)
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  private pausedTotal = 0;
  private pausedAt = 0;
  private pausing = false;
  private samples: number[] = [];
  private lastDb: number | null = null;
  private sawMetering = false;
  private perm: 'unknown' | 'granted' | 'denied' = 'unknown';
  private asking: Promise<boolean> | null = null;
  private modeReady = false;
  private dead = false;

  constructor(cb: EngineCallbacks, deps: EngineDeps = {}) {
    this.cb = cb;
    this.audio = deps.audio || realAudio;
    this.now = deps.now || (() => Date.now());
    this.deleteFile = deps.deleteFile || (async () => {});
    this.os = deps.os || Platform.OS;
  }

  setCallbacks(cb: EngineCallbacks) { this.cb = cb; }
  get snapshot() { return this.snap; }
  get phase() { return this.snap.phase; }
  get isDead() { return this.dead; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;

  private set(p: Partial<Snapshot>) {
    if (this.dead) return;
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((l) => l());
  }

  // Composer mount: learn the permission without a prompt and set the audio mode once (Android), so a press = 1 native call.
  async prepare() {
    try {
      const p = await this.audio.getPermissionsAsync();
      if (p.granted) this.perm = 'granted';
      if (p.granted && this.os !== 'ios') await this.ensureMode();
    } catch (e) {}
  }

  private async ensureMode() {
    // iOS: playback (VoiceBubble) switches allowsRecordingIOS off, so set it on every start there
    if (this.modeReady && this.os !== 'ios') return;
    await this.audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    this.modeReady = true;
  }

  private ask(): Promise<boolean> {
    if (!this.asking) {
      this.asking = this.audio.requestPermissionsAsync()
        .then((p) => { this.perm = p.granted ? 'granted' : 'denied'; return p.granted; })
        .catch(() => false)
        .finally(() => { this.asking = null; });
    }
    return this.asking;
  }

  // Finger down on the mic.
  async start(): Promise<void> {
    if (this.dead || this.snap.phase !== 'idle') return;
    if (this.perm !== 'granted') {
      // first press only asks (the system dialog steals the finger anyway); the next press records
      try {
        const p = await this.audio.getPermissionsAsync();
        if (p.granted) this.perm = 'granted';
      } catch (e) {}
      if (this.perm !== 'granted') {
        const ok = await this.ask();
        if (this.dead) return;
        if (!ok) this.cb.onError(MSG.denied);
        else this.cb.onNotice?.(MSG.granted);
        return;
      }
    }
    const id = ++this.seq;
    this.samples = [];
    this.lastDb = null;
    this.sawMetering = false;
    this.pausedTotal = 0;
    this.pausedAt = 0;
    this.set({ phase: 'starting', paused: false, ms: 0, levels: [], leftMs: null });
    this.watchdog = setTimeout(() => {
      if (id !== this.seq || this.snap.phase !== 'starting') return;
      this.seq++; // the late recording gets disposed when (if) it resolves
      const p = this.pending;
      this.pending = null;
      if (p) this.dispose(p, true);
      this.teardown();
      this.cb.onError(MSG.watchdog);
    }, START_TIMEOUT_MS);
    try {
      await this.ensureMode();
      if (id !== this.seq) return;
      let r: RecordingLike;
      try {
        r = await this.prepareOne(id);
      } catch (e: any) {
        if (id !== this.seq) return;
        if (micErrorText(e) !== MSG.busy || !leaked) throw e;
        const old = leaked; // a recorder from an earlier session still holds the mic: free it and try once more
        leaked = null;
        await old.stopAndUnloadAsync().catch(() => {});
        if (id !== this.seq) return;
        r = await this.prepareOne(id);
      }
      if (id !== this.seq) { this.dispose(r, true); return; }
      await r.startAsync();
      this.pending = null;
      if (id !== this.seq) { this.dispose(r, true); return; }
      this.rec = r;
      if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
      this.t0 = this.now();
      this.set({ phase: 'rec' });
      this.ticker = setInterval(this.tick, TICK_MS);
    } catch (e: any) {
      if (id !== this.seq) return; // already cancelled / timed out: that path did the cleanup
      this.seq++;
      const p = this.pending;
      this.pending = null;
      if (p) this.dispose(p, true);
      this.teardown();
      if (/permission/i.test(String(e?.message || ''))) this.perm = 'denied';
      this.cb.onError(micErrorText(e));
    }
  }

  private async prepareOne(id: number): Promise<RecordingLike> {
    const r = this.audio.newRecording();
    this.pending = r;
    r.setProgressUpdateInterval(TICK_MS);
    r.setOnRecordingStatusUpdate((st) => {
      if (id !== this.seq) return;
      if (typeof st.metering === 'number') { this.lastDb = st.metering; this.sawMetering = true; }
    });
    try {
      await r.prepareToRecordAsync(OPTIONS);
      this.prepared.add(r);
      leaked = r; // holds the native recorder until it is unloaded
    } catch (e) {
      if (this.pending === r) this.pending = null;
      throw e;
    }
    return r;
  }

  private elapsed() {
    const pausedNow = this.pausedAt ? this.now() - this.pausedAt : 0;
    return Math.max(0, this.now() - this.t0 - this.pausedTotal - pausedNow);
  }

  private tick = () => {
    const ph = this.snap.phase;
    if (ph !== 'rec' && ph !== 'locked') return;
    const ms = this.elapsed();
    if (ms >= MAX_MS) { this.finish(true); return; }
    let levels = this.snap.levels;
    if (!this.pausedAt) {
      // no metering from this device: a gentle fake pulse so the bar visibly moves while recording
      const lv = this.sawMetering && this.lastDb != null ? levelOf(this.lastDb) : 0.25 + 0.3 * Math.abs(Math.sin(ms / 180));
      this.samples.push(lv);
      levels = this.samples.slice(-60);
    }
    const left = MAX_MS - ms;
    this.set({ ms, levels, leftMs: left <= WARN_MS ? left : null });
  };

  // Slide up: only a real recording can be locked (a lock while starting would leave a bar with nothing behind it).
  lock() {
    if (this.snap.phase === 'rec' && this.rec) this.set({ phase: 'locked' });
  }

  async togglePause() {
    const r = this.rec;
    if (!r || this.snap.phase !== 'locked' || this.pausing) return;
    this.pausing = true;
    try {
      if (this.pausedAt) {
        await r.startAsync();
        if (this.rec !== r) return;
        this.pausedTotal += this.now() - this.pausedAt;
        this.pausedAt = 0;
        this.set({ paused: false });
      } else {
        await r.pauseAsync();
        if (this.rec !== r) return;
        this.pausedAt = this.now();
        this.set({ paused: true });
      }
    } catch (e) {
    } finally {
      this.pausing = false;
    }
  }

  send = () => this.finish(true);
  cancel = () => this.finish(false);

  // App went to the background: stop and discard (never auto-send something the user did not confirm).
  background() {
    if (this.snap.phase === 'idle') return;
    this.finish(false);
    this.cb.onNotice?.(MSG.background);
  }

  // Every exit path. Idempotent; the UI is idle before the first await.
  async finish(send: boolean): Promise<void> {
    const ph = this.snap.phase;
    if (ph === 'idle') return;
    if (ph === 'starting') {
      // released / cancelled before the mic started: idle now; start() disposes the recording when it resolves
      this.seq++;
      const p = this.pending;
      this.pending = null;
      if (p) this.dispose(p, true);
      this.teardown();
      if (send) this.cb.onShort();
      return;
    }
    const r = this.rec;
    const clockMs = this.elapsed();
    const samples = this.samples;
    this.seq++;
    this.rec = null;
    this.teardown();
    if (!r) return;
    let durationMs = clockMs;
    if (send) {
      try {
        const st = await r.getStatusAsync();
        if (st && st.durationMillis) durationMs = st.durationMillis;
      } catch (e) {}
    }
    const uri = r.getURI();
    let stopErr: any = null;
    if (!this.disposed.has(r)) {
      this.disposed.add(r);
      try { await r.stopAndUnloadAsync(); } catch (e) { stopErr = e; }
      if (leaked === r) leaked = null;
    }
    if (this.dead) { if (uri) this.deleteFile(uri).catch(() => {}); return; }
    if (!send || !uri) { if (uri) this.deleteFile(uri).catch(() => {}); return; }
    if (durationMs < MIN_MS) { this.deleteFile(uri).catch(() => {}); this.cb.onShort(); return; }
    if (stopErr) { this.deleteFile(uri).catch(() => {}); this.cb.onError(MSG.failed); return; }
    this.cb.onDone({ uri, durationMs, waveform: peaks(samples, 48) });
  }

  // Unload a recording at most once, never throws; discarded files are deleted. A recording still preparing cannot be
  // unloaded yet: start() calls dispose again when the prepare resolves (its sequence id is stale by then).
  private dispose(r: RecordingLike, discard: boolean) {
    if (this.disposed.has(r)) return;
    r.setOnRecordingStatusUpdate(null);
    if (!this.prepared.has(r)) return;
    this.disposed.add(r);
    const uri = r.getURI();
    r.stopAndUnloadAsync()
      .catch(() => {})
      .then(() => {
        if (leaked === r) leaked = null;
        if (discard && uri) this.deleteFile(uri).catch(() => {});
      });
  }

  // Timers off, phase idle. Safe to call any number of times.
  private teardown() {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
    this.pausedAt = 0;
    this.pausing = false;
    if (this.os === 'ios' && this.modeReady) {
      this.modeReady = false;
      this.audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
    if (this.snap.phase !== 'idle' || this.snap.paused) this.set({ phase: 'idle', paused: false, leftMs: null });
  }

  // Composer unmount: dispose whatever exists or is still starting; no callbacks afterwards.
  destroy() {
    this.seq++;
    const r = this.rec;
    const p = this.pending;
    this.rec = null;
    this.pending = null;
    this.teardown();
    this.dead = true;
    this.listeners.clear();
    if (r) this.dispose(r, true);
    if (p) this.dispose(p, true);
  }
}

export const __resetLeakedForTests = () => { leaked = null; };
