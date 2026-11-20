// R-05 / R-02: voice recorder state machine. The engine is real; only expo-av's native Audio is replaced by a controllable fake.
import { RecorderEngine, AudioLike, RecordingLike, MIN_MS, MAX_MS, START_TIMEOUT_MS, MSG, __resetLeakedForTests } from '../recorderEngine';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: any) => void };
const deferred = (): Deferred => {
  let resolve!: () => void; let reject!: (e: any) => void;
  const promise = new Promise<void>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

class FakeRecording implements RecordingLike {
  static made: FakeRecording[] = [];
  id = FakeRecording.made.length + 1;
  prepared = false;
  unloaded = false;
  started = false;
  cb: ((s: any) => void) | null = null;
  prep: Deferred | null = null; // set = prepare hangs until resolved
  startD: Deferred | null = null;
  durationMillis: number | null = null;
  stopAndUnloadAsync = jest.fn(async () => {
    if (!this.prepared) throw new Error('Cannot unload a Recording that has not been prepared.');
    if (this.unloaded) throw new Error('Cannot unload a Recording that has already been unloaded.');
    this.unloaded = true;
  });
  pauseAsync = jest.fn(async () => {});
  constructor() { FakeRecording.made.push(this); }
  setProgressUpdateInterval() {}
  setOnRecordingStatusUpdate(cb: any) { this.cb = cb; }
  async prepareToRecordAsync() { if (this.prep) await this.prep.promise; this.prepared = true; }
  async startAsync() { if (this.startD) await this.startD.promise; this.started = true; }
  async getStatusAsync() { return { durationMillis: this.durationMillis ?? 0, isRecording: true } as any; }
  getURI() { return this.prepared ? 'file:///rec-' + this.id + '.m4a' : null; }
  emit(metering?: number) { this.cb && this.cb({ isRecording: true, durationMillis: 0, metering }); }
}

let nextPrepare: Deferred | null = null;
let nextStart: Deferred | null = null;
let granted = true;
const audio: AudioLike = {
  getPermissionsAsync: jest.fn(async () => ({ granted })),
  requestPermissionsAsync: jest.fn(async () => ({ granted })),
  setAudioModeAsync: jest.fn(async () => {}),
  newRecording: () => {
    const r = new FakeRecording();
    r.prep = nextPrepare; r.startD = nextStart;
    nextPrepare = null; nextStart = null;
    return r;
  },
};

let clock = 1_000_000;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const cbs = () => ({ onDone: jest.fn(), onShort: jest.fn(), onError: jest.fn(), onNotice: jest.fn() });
const make = (c = cbs()) => ({ c, e: new RecorderEngine(c, { audio, now: () => clock, deleteFile: deleteFile, os: 'android' }) });
const deleteFile = jest.fn(async (_: string) => {});
const advance = async (ms: number) => { for (let t = 0; t < ms; t += 100) { clock += 100; jest.advanceTimersByTime(100); await flush(); } };

beforeEach(() => {
  jest.useFakeTimers();
  FakeRecording.made = [];
  nextPrepare = null; nextStart = null; granted = true;
  clock = 1_000_000;
  deleteFile.mockClear();
  (audio.setAudioModeAsync as jest.Mock).mockClear();
  (audio.requestPermissionsAsync as jest.Mock).mockClear();
  __resetLeakedForTests();
});
afterEach(() => { jest.useRealTimers(); });

test('a normal hold records, the timer comes from the clock and release sends', async () => {
  const { c, e } = make();
  await e.start();
  expect(e.phase).toBe('rec');
  const r = FakeRecording.made[0];
  await advance(2500);
  expect(e.snapshot.ms).toBe(2500); // now - t0, not the status callback
  r.durationMillis = 2500;
  await e.send();
  expect(e.phase).toBe('idle');
  expect(r.unloaded).toBe(true);
  expect(c.onDone).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///rec-1.m4a', durationMs: 2500 }));
  expect(c.onDone.mock.calls[0][0].waveform).toHaveLength(48);
});

test('hung start: cancel goes idle immediately and the late recording is unloaded', async () => {
  const { c, e } = make();
  nextPrepare = deferred();
  const hang = nextPrepare;
  const p = e.start();
  await flush();
  expect(e.phase).toBe('starting');
  e.cancel();
  expect(e.phase).toBe('idle'); // synchronously, no await on native
  hang.resolve(); // the native prepare finally answers
  await p; await flush();
  const r = FakeRecording.made[0];
  expect(r.started).toBe(false); // never started recording after the cancel
  expect(r.stopAndUnloadAsync).toHaveBeenCalledTimes(1);
  expect(r.unloaded).toBe(true);
  expect(c.onDone).not.toHaveBeenCalled();
  expect(deleteFile).toHaveBeenCalledWith('file:///rec-1.m4a');
});

test('release while still starting = idle + short toast, never a stuck bar', async () => {
  const { c, e } = make();
  nextStart = deferred();
  const hang = nextStart;
  const p = e.start();
  await flush();
  e.send();
  expect(e.phase).toBe('idle');
  expect(c.onShort).toHaveBeenCalledTimes(1);
  hang.resolve(); await p; await flush();
  expect(FakeRecording.made[0].unloaded).toBe(true);
  expect(c.onDone).not.toHaveBeenCalled();
});

test('watchdog: start not done in 3 s -> idle + toast, late recording disposed, next press works', async () => {
  const { c, e } = make();
  nextPrepare = deferred();
  const hang = nextPrepare;
  const p = e.start();
  await flush();
  jest.advanceTimersByTime(START_TIMEOUT_MS - 1);
  expect(e.phase).toBe('starting');
  jest.advanceTimersByTime(1);
  expect(e.phase).toBe('idle');
  expect(c.onError).toHaveBeenCalledWith(MSG.watchdog);
  hang.resolve(); await p; await flush();
  expect(FakeRecording.made[0].unloaded).toBe(true);
  await e.start();
  expect(e.phase).toBe('rec');
  expect(FakeRecording.made).toHaveLength(2);
});

test('lock is impossible without a running recorder; trash after lock reaches idle', async () => {
  const { e } = make();
  nextPrepare = deferred();
  const hang = nextPrepare;
  const p = e.start();
  await flush();
  e.lock();
  expect(e.phase).toBe('starting');
  hang.resolve(); await p;
  expect(e.phase).toBe('rec');
  e.lock();
  expect(e.phase).toBe('locked');
  await e.cancel();
  expect(e.phase).toBe('idle');
  expect(FakeRecording.made[0].unloaded).toBe(true);
});

test('double finish is safe (one unload, one send)', async () => {
  const { c, e } = make();
  await e.start();
  await advance(1500);
  FakeRecording.made[0].durationMillis = 1500;
  await Promise.all([e.send(), e.send(), e.cancel()]);
  expect(FakeRecording.made[0].stopAndUnloadAsync).toHaveBeenCalledTimes(1);
  expect(c.onDone).toHaveBeenCalledTimes(1);
  expect(c.onError).not.toHaveBeenCalled();
});

test('shorter than the minimum is discarded', async () => {
  const { c, e } = make();
  await e.start();
  await advance(MIN_MS - 300);
  FakeRecording.made[0].durationMillis = MIN_MS - 300;
  await e.send();
  expect(c.onDone).not.toHaveBeenCalled();
  expect(c.onShort).toHaveBeenCalledTimes(1);
  expect(deleteFile).toHaveBeenCalledWith('file:///rec-1.m4a');
});

test('max length: countdown hint near the end, then auto-send', async () => {
  const { c, e } = make();
  await e.start();
  e.lock();
  clock += MAX_MS - 20_000; // jump close to the end
  jest.advanceTimersByTime(100); await flush();
  expect(e.snapshot.leftMs).toBeLessThanOrEqual(20_000);
  expect(e.snapshot.leftMs).toBeGreaterThan(0);
  FakeRecording.made[0].durationMillis = MAX_MS;
  clock += 20_000;
  jest.advanceTimersByTime(100); await flush();
  expect(e.phase).toBe('idle');
  expect(c.onDone).toHaveBeenCalledTimes(1);
});

test('pause time is not counted by the clock timer', async () => {
  const { e } = make();
  await e.start();
  e.lock();
  await advance(1000);
  await e.togglePause();
  expect(e.snapshot.paused).toBe(true);
  await advance(5000);
  expect(e.snapshot.ms).toBe(1000);
  await e.togglePause();
  await advance(500);
  expect(e.snapshot.ms).toBe(1500);
});

test('waveform follows metering; without metering it still moves (fallback)', async () => {
  const { e } = make();
  await e.start();
  const r = FakeRecording.made[0];
  r.emit(-10); await advance(100);
  r.emit(-45); await advance(100);
  const [a, b] = e.snapshot.levels.slice(-2);
  expect(a).toBeGreaterThan(b);
  await e.cancel();
  await e.start(); // second recording, device gives no metering
  await advance(600);
  const lv = e.snapshot.levels;
  expect(new Set(lv).size).toBeGreaterThan(1);
});

test('unmount during a pending start disposes the late recording and calls nothing back', async () => {
  const { c, e } = make();
  nextPrepare = deferred();
  const hang = nextPrepare;
  const p = e.start();
  await flush();
  e.destroy();
  hang.resolve(); await p; await flush();
  expect(FakeRecording.made[0].unloaded).toBe(true);
  expect(FakeRecording.made[0].started).toBe(false);
  expect(c.onDone).not.toHaveBeenCalled();
  expect(c.onError).not.toHaveBeenCalled();
});

test('unmount while recording unloads the recorder', async () => {
  const { e } = make();
  await e.start();
  e.destroy();
  await flush();
  expect(FakeRecording.made[0].unloaded).toBe(true);
});

test('app to background: stop and discard, never send', async () => {
  const { c, e } = make();
  await e.start();
  e.lock();
  await advance(3000);
  e.background();
  expect(e.phase).toBe('idle');
  await flush();
  expect(c.onDone).not.toHaveBeenCalled();
  expect(c.onNotice).toHaveBeenCalledWith(MSG.background);
  expect(FakeRecording.made[0].unloaded).toBe(true);
});

test('no permission yet: the first press only asks, the next press records; audio mode set once', async () => {
  granted = false;
  const { c, e } = make();
  await e.prepare();
  (audio.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false }); // not granted at the press
  granted = true; // user taps Allow in the system dialog
  await e.start();
  expect(audio.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(e.phase).toBe('idle');
  expect(FakeRecording.made).toHaveLength(0);
  expect(c.onNotice).toHaveBeenCalledWith(MSG.granted);
  await e.start();
  expect(e.phase).toBe('rec');
  await e.cancel();
  await e.start();
  expect(audio.setAudioModeAsync).toHaveBeenCalledTimes(1);
});

test('permission denied -> clear message, stays idle', async () => {
  granted = false;
  const { c, e } = make();
  await e.start();
  expect(e.phase).toBe('idle');
  expect(c.onError).toHaveBeenCalledWith(MSG.denied);
});

test('mic busy: a leaked recorder from before is freed and the start retried once', async () => {
  const { c, e } = make();
  await e.start(); // this one will leak: its unload hangs forever
  const first = FakeRecording.made[0];
  first.stopAndUnloadAsync.mockImplementationOnce(() => new Promise(() => {}));
  e.cancel();
  expect(e.phase).toBe('idle');
  // the next recording fails with the expo-av busy error until the first is unloaded
  const origNew = audio.newRecording;
  let calls = 0;
  (audio as any).newRecording = () => {
    const r = origNew() as FakeRecording;
    if (calls++ === 0) r.prepareToRecordAsync = async () => { throw new Error('Only one Recording object can be prepared at a given time.'); };
    return r;
  };
  first.stopAndUnloadAsync.mockImplementation(async () => { first.unloaded = true; });
  await e.start();
  (audio as any).newRecording = origNew;
  expect(e.phase).toBe('rec');
  expect(c.onError).not.toHaveBeenCalled();
});

test('start error -> idle and a readable message', async () => {
  const { c, e } = make();
  (audio as any).newRecording = ((orig) => () => {
    const r = orig() as FakeRecording;
    r.startAsync = async () => { throw new Error('start failed'); };
    (audio as any).newRecording = orig;
    return r;
  })(audio.newRecording);
  await e.start();
  expect(e.phase).toBe('idle');
  expect(c.onError).toHaveBeenCalledWith(MSG.busy);
  expect(FakeRecording.made[0].unloaded).toBe(true);
});
