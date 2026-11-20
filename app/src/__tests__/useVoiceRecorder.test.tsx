// Hook glue for the recorder: real hook + real engine; expo-av's native Audio replaced by a controllable fake.
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

const mockMade: any[] = [];
let mockHang: null | { resolve: () => void; promise: Promise<void> } = null;
jest.mock('expo-av', () => {
  class Recording {
    prepared = false; unloaded = false; started = false; cb: any = null; prep: any;
    stopAndUnloadAsync = jest.fn(async () => {
      if (!this.prepared) throw new Error('Cannot unload a Recording that has not been prepared.');
      this.unloaded = true;
    });
    constructor() { mockMade.push(this); this.prep = mockHang; mockHang = null; }
    setProgressUpdateInterval() {}
    setOnRecordingStatusUpdate(cb: any) { this.cb = cb; }
    async prepareToRecordAsync() { if (this.prep) await this.prep.promise; this.prepared = true; }
    async startAsync() { this.started = true; }
    async pauseAsync() {}
    async getStatusAsync() { return { durationMillis: 5000 }; }
    getURI() { return 'file:///r.m4a'; }
  }
  return {
    Audio: {
      Recording,
      RecordingOptionsPresets: { HIGH_QUALITY: { android: {}, ios: {}, web: {} } },
      AndroidOutputFormat: { MPEG_4: 2 }, AndroidAudioEncoder: { AAC: 3 },
      getPermissionsAsync: jest.fn(async () => ({ granted: true })),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      setAudioModeAsync: jest.fn(async () => {}),
    },
  };
});
jest.mock('expo-file-system', () => ({ deleteAsync: jest.fn(async () => {}) }));

import { useVoiceRecorder } from '../components/VoiceRecorder';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const cbs = () => ({ onDone: jest.fn(), onShort: jest.fn(), onError: jest.fn(), onNotice: jest.fn() });

beforeEach(() => { mockMade.length = 0; mockHang = null; });

test('unmount during a pending start disposes the late recording (no leaked mic next time)', async () => {
  let resolve!: () => void;
  mockHang = { promise: new Promise<void>((r) => { resolve = r; }), resolve: () => resolve() };
  const c = cbs();
  const h = renderHook(() => useVoiceRecorder(c));
  await act(async () => { await flush(); });
  act(() => { h.result.current.start(); });
  await act(async () => { await flush(); });
  expect(h.result.current.state).toBe('starting');
  h.unmount();
  resolve();
  await act(async () => { await flush(); });
  expect(mockMade[0].unloaded).toBe(true);
  expect(mockMade[0].started).toBe(false);
  expect(c.onDone).not.toHaveBeenCalled();
});

test('app going to the background while recording discards (never sends)', async () => {
  const listeners: ((s: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: any, fn: any) => {
    listeners.push(fn);
    return { remove: () => {} };
  }) as any);
  const c = cbs();
  const h = renderHook(() => useVoiceRecorder(c));
  await act(async () => { h.result.current.start(); await flush(); });
  expect(h.result.current.state).toBe('rec');
  await act(async () => { listeners.forEach((l) => l('background')); await flush(); });
  expect(h.result.current.state).toBe('idle');
  expect(mockMade[0].unloaded).toBe(true);
  expect(c.onDone).not.toHaveBeenCalled();
  spy.mockRestore();
});
