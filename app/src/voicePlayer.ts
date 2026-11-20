// Voice-note player state machine (hardening R-09, "recording play nahi ho rahi"). Plain TypeScript, no React: VoiceBubble
// subscribes with useVoicePlayer(key). Why it exists - the old bubble kept one expo-av Sound per bubble and swallowed every error:
// - expo-av (Android) loads the file, then tries to take audio focus. If that fails (app seen as "in the background", a call,
//   another app holding focus) createAsync still RESOLVES with a loaded-but-silent sound, and every later playAsync rejects.
//   The bubble only checked `isLoaded`, so it sat on "play" forever until the chat was reopened.
// - a stream error (expired signed URL, 403, network change) arrives as a status {isLoaded:false, error}: it was ignored, the
//   dead sound stayed in place and every tap returned early.
// Rules here:
// - one note plays at a time; every load has a sequence id and a load that resolves after a newer request is unloaded at once
// - load with shouldPlay:false, then an explicit playAsync, so a focus failure is an error we see, never a silent sound
// - any failure (load reject, playAsync reject, error status) unloads the sound; the first failure of a request retries once
//   with a FRESHLY signed URL from the same position; a second failure ends in 'error' + one toast, and the next tap starts clean
// - finish -> unloaded, position 0, so play again always starts a new sound with a new URL
// - the audio mode is set before every play (the recorder changes it) with staysActiveInBackground so expo-av's own
//   "app is paused" flag can never block focus; the bubble pauses on AppState background itself (pauseCurrent)
import { Audio, AVPlaybackStatus } from 'expo-av';
import { AppState } from 'react-native';

export type PlayState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type Snapshot = { state: PlayState; pos: number; dur: number };

export type SoundLike = {
  playAsync(): Promise<unknown>;
  pauseAsync(): Promise<unknown>;
  setPositionAsync(ms: number): Promise<unknown>;
  setRateAsync(rate: number, correctPitch: boolean): Promise<unknown>;
  unloadAsync(): Promise<unknown>;
};
export type PlayerDeps = {
  // resolves the playable URL of a note; force = ignore any cached signature and sign again
  resolveUrl: (path: string, force: boolean) => Promise<string | null>;
  createSound: (uri: string, init: { positionMillis: number; rate: number }, onStatus: (s: AVPlaybackStatus) => void) => Promise<SoundLike>;
  setAudioMode: () => Promise<void>;
  onError?: (msg: string) => void;
};

export const MSG = {
  failed: "Couldn't play this voice note. Tap play to try again.",
  offline: "Voice note isn't available right now. Check the internet and tap play again.",
};

const IDLE: Snapshot = { state: 'idle', pos: 0, dur: 0 };

type Active = { key: string; path: string; seq: number; sound: SoundLike | null; rate: number; retried: boolean; dead?: boolean };

export class VoicePlayer {
  private snaps = new Map<string, Snapshot>();
  private subs = new Map<string, Set<(s: Snapshot) => void>>();
  private active: Active | null = null;
  private seq = 0;
  constructor(private deps: PlayerDeps) {}

  get(key: string): Snapshot {
    return this.snaps.get(key) || IDLE;
  }

  subscribe(key: string, fn: (s: Snapshot) => void): () => void {
    let set = this.subs.get(key);
    if (!set) { set = new Set(); this.subs.set(key, set); }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.subs.delete(key);
    };
  }

  private set(key: string, patch: Partial<Snapshot>) {
    const next = { ...this.get(key), ...patch };
    this.snaps.set(key, next);
    this.subs.get(key)?.forEach((f) => f(next));
  }

  // Known duration (from the message) so the seek bar works before the first play.
  setDuration(key: string, dur: number) {
    if (dur > 0 && !this.get(key).dur) this.snaps.set(key, { ...this.get(key), dur });
  }

  private isActive(key: string) {
    return !!this.active && this.active.key === key;
  }

  // Play / pause button.
  async toggle(key: string, path: string, rate = 1): Promise<void> {
    const s = this.get(key);
    if (this.isActive(key) && this.active!.sound) {
      if (s.state === 'playing') return this.pause(key);
      return this.resume(key);
    }
    if (this.isActive(key) && s.state === 'loading') return; // double tap while loading
    const from = s.dur && s.pos >= s.dur ? 0 : s.pos;
    await this.start(key, path, from, rate, false);
  }

  private async start(key: string, path: string, from: number, rate: number, retried: boolean): Promise<void> {
    // swap synchronously: two quick taps can never both become the active request
    const prev = this.active;
    const seq = ++this.seq;
    const a: Active = { key, path, seq, sound: null, rate, retried };
    this.active = a;
    if (prev) {
      const ps = prev.sound;
      prev.sound = null;
      prev.dead = true;
      if (prev.key !== key) this.set(prev.key, { state: 'idle', pos: 0 });
      if (ps) { try { await ps.unloadAsync(); } catch (e) {} }
    }
    if (this.active !== a) return;
    this.set(key, { state: 'loading', pos: from });
    let sound: SoundLike | null = null;
    try {
      const uri = await this.deps.resolveUrl(path, retried);
      if (!uri) throw new Error('no url');
      if (this.active !== a) return;
      await this.deps.setAudioMode();
      sound = await this.deps.createSound(uri, { positionMillis: from, rate }, (st) => this.onStatus(a, st));
      if (this.active !== a) { sound.unloadAsync().catch(() => {}); return; } // a newer tap won
      a.sound = sound;
      await sound.playAsync(); // focus failures surface here (rejects), never as a silent loaded sound
      if (this.active === a && this.get(key).state === 'loading') this.set(key, { state: 'playing' });
    } catch (e) {
      if (this.active !== a) { if (sound) sound.unloadAsync().catch(() => {}); return; }
      await this.fail(a, e);
    }
  }

  // Unload, then retry once from the same position with a newly signed URL; else 'error' + toast.
  private async fail(a: Active, e: unknown) {
    if (a.dead) return; // the error status and the rejected call can both report one failure
    a.dead = true;
    const pos = this.get(a.key).pos;
    const s = a.sound;
    a.sound = null;
    if (s) s.unloadAsync().catch(() => {});
    if (this.active !== a) return; // a newer request already replaced it
    if (!a.retried) {
      this.active = null;
      return this.start(a.key, a.path, pos, a.rate, true);
    }
    this.active = null;
    this.set(a.key, { state: 'error' });
    const m = String((e as any)?.message || e || '');
    this.deps.onError?.(/network|internet|unable to resolve|no url|timeout/i.test(m) ? MSG.offline : MSG.failed);
  }

  private onStatus(a: Active, st: AVPlaybackStatus) {
    if (this.active !== a) return;
    if (!st.isLoaded) {
      if (st.error) this.fail(a, new Error(st.error));
      return;
    }
    if (st.didJustFinish) {
      const s = a.sound;
      a.sound = null;
      this.active = null;
      if (s) s.unloadAsync().catch(() => {});
      this.set(a.key, { state: 'idle', pos: 0, dur: st.durationMillis || this.get(a.key).dur });
      return;
    }
    const patch: Partial<Snapshot> = { pos: st.positionMillis };
    if (st.durationMillis) patch.dur = st.durationMillis;
    if (a.sound) patch.state = st.isPlaying ? 'playing' : this.get(a.key).state === 'loading' ? 'loading' : 'paused';
    this.set(a.key, patch);
  }

  async pause(key: string) {
    if (!this.isActive(key) || !this.active!.sound) return;
    const a = this.active!;
    this.set(key, { state: 'paused' });
    try { await a.sound!.pauseAsync(); } catch (e) { /* paused or gone: the next tap reloads */ }
  }

  private async resume(key: string) {
    const a = this.active!;
    this.set(key, { state: 'playing' });
    try {
      await a.sound!.playAsync();
    } catch (e) {
      a.retried = false; // a fresh failure after a good play gets its own retry
      await this.fail(a, e);
    }
  }

  async seek(key: string, ms: number) {
    const dur = this.get(key).dur;
    const pos = Math.max(0, dur ? Math.min(dur, ms) : ms);
    this.set(key, { pos, ...(this.get(key).state === 'error' ? { state: 'idle' as PlayState } : {}) });
    if (this.isActive(key) && this.active!.sound) {
      try { await this.active!.sound!.setPositionAsync(pos); } catch (e) { /* status error path handles a dead sound */ }
    }
  }

  async setRate(key: string, rate: number) {
    if (this.isActive(key)) {
      this.active!.rate = rate;
      if (this.active!.sound) { try { await this.active!.sound!.setRateAsync(rate, true); } catch (e) {} }
    }
  }

  // Stop whatever plays (another note started, app to background, logout). keepKey: the note about to start keeps its position.
  private async stopActive(keepKey?: string) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const s = a.sound;
    a.sound = null;
    if (a.key !== keepKey) this.set(a.key, { state: 'idle', pos: 0 });
    if (s) { try { await s.unloadAsync(); } catch (e) {} }
  }

  async stop() {
    await this.stopActive();
  }

  // App went to the background: pause (keeps the position, like a chat app).
  async pauseCurrent() {
    if (this.active && this.active.sound && this.get(this.active.key).state === 'playing') await this.pause(this.active.key);
  }

  // A bubble unmounts: stop only if it is the one playing.
  async release(key: string) {
    if (this.isActive(key)) await this.stopActive();
    this.snaps.delete(key);
  }
}

// ---- the app's single player ----
let real: VoicePlayer | null = null;
export function voicePlayer(): VoicePlayer {
  if (!real) {
    // lazy requires: tests of other modules never load expo-av / media
    const { signedMediaUrl } = require('./media');
    const { toast } = require('./useVoiceInput');
    real = new VoicePlayer({
      resolveUrl: (path, force) => signedMediaUrl(path, force),
      createSound: async (uri, init, onStatus) => {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: false, positionMillis: init.positionMillis, rate: init.rate, shouldCorrectPitch: true, progressUpdateIntervalMillis: 120 },
          onStatus,
        );
        return sound;
      },
      setAudioMode: () => Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: true }),
      onError: (m) => toast(m),
    });
    AppState.addEventListener('change', (st) => { if (st !== 'active') real!.pauseCurrent(); });
  }
  return real;
}
