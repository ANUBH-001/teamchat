// R-09 "recording play nahi ho rahi": the voice-note player never gets stuck on a silent / dead sound.
jest.mock('expo-av', () => ({ Audio: { Sound: { createAsync: jest.fn() }, setAudioModeAsync: jest.fn() } }));
import { MSG, PlayerDeps, SoundLike, VoicePlayer } from '../voicePlayer';

type Fake = SoundLike & { onStatus: (s: any) => void; uri: string; init: any; unloaded: number };

function setup(opts: { playFails?: number; loadFails?: number; urlFor?: (path: string, force: boolean) => string | null } = {}) {
  const sounds: Fake[] = [];
  const urls: Array<[string, boolean]> = [];
  const errors: string[] = [];
  let playFails = opts.playFails || 0;
  let loadFails = opts.loadFails || 0;
  const deps: PlayerDeps = {
    resolveUrl: async (path, force) => {
      urls.push([path, force]);
      return opts.urlFor ? opts.urlFor(path, force) : 'https://srv.test' + path + '?sig=' + urls.length;
    },
    setAudioMode: jest.fn(async () => {}),
    createSound: async (uri, init, onStatusTyped) => {
      const onStatus = onStatusTyped as (s: any) => void;
      if (loadFails > 0) { loadFails--; throw new Error('E_LOAD_ERROR: HTTP 403'); }
      const s: Fake = {
        uri, init, onStatus, unloaded: 0,
        playAsync: jest.fn(async () => {
          if (playFails > 0) { playFails--; throw new Error('Audio focus could not be acquired from the OS at this time.'); }
          onStatus({ isLoaded: true, isPlaying: true, positionMillis: init.positionMillis, durationMillis: 10000 });
        }),
        pauseAsync: jest.fn(async () => { onStatus({ isLoaded: true, isPlaying: false, positionMillis: 3000, durationMillis: 10000 }); }),
        setPositionAsync: jest.fn(async () => {}),
        setRateAsync: jest.fn(async () => {}),
        unloadAsync: jest.fn(async () => { s.unloaded++; }),
      };
      sounds.push(s);
      return s;
    },
    onError: (m) => errors.push(m),
  };
  return { p: new VoicePlayer(deps), sounds, urls, errors, deps };
}

const A = '/media/f/2026/11/a.m4a';
const B = '/media/f/2026/11/b.m4a';

test('play loads with a fresh URL, plays explicitly, pause / resume reuse the sound', async () => {
  const { p, sounds, urls } = setup();
  await p.toggle('1', A);
  expect(urls).toEqual([[A, false]]);
  expect(sounds).toHaveLength(1);
  expect(sounds[0].playAsync).toHaveBeenCalledTimes(1);
  expect(p.get('1').state).toBe('playing');
  await p.toggle('1', A);
  expect(p.get('1').state).toBe('paused');
  expect(p.get('1').pos).toBe(3000);
  await p.toggle('1', A);
  expect(p.get('1').state).toBe('playing');
  expect(sounds).toHaveLength(1);
});

test('audio focus refused on the first play -> unloaded and retried once with a re-signed URL', async () => {
  const { p, sounds, urls, errors } = setup({ playFails: 1 });
  await p.toggle('1', A);
  expect(sounds).toHaveLength(2);
  expect(sounds[0].unloaded).toBe(1);
  expect(urls).toEqual([[A, false], [A, true]]);
  expect(p.get('1').state).toBe('playing');
  expect(errors).toEqual([]);
});

test('fails twice -> error state + one toast, never stuck: the next tap starts a new sound', async () => {
  const { p, sounds, errors } = setup({ playFails: 2 });
  await p.toggle('1', A);
  expect(p.get('1').state).toBe('error');
  expect(errors).toEqual([MSG.failed]);
  expect(sounds.every((s) => s.unloaded === 1)).toBe(true);
  await p.toggle('1', A); // works now
  expect(sounds).toHaveLength(3);
  expect(p.get('1').state).toBe('playing');
});

test('expired / forbidden URL (load rejects) -> re-signed and loaded again', async () => {
  const { p, sounds, urls } = setup({ loadFails: 1 });
  await p.toggle('1', A);
  expect(urls).toEqual([[A, false], [A, true]]);
  expect(sounds).toHaveLength(1);
  expect(p.get('1').state).toBe('playing');
});

test('a stream error mid-play (URL expired while paused) resumes from the same position with a new URL', async () => {
  const { p, sounds, urls } = setup();
  await p.toggle('1', A);
  sounds[0].onStatus({ isLoaded: true, isPlaying: true, positionMillis: 4200, durationMillis: 10000 });
  sounds[0].onStatus({ isLoaded: false, error: 'com.google.android.exoplayer2.upstream.HttpDataSource$InvalidResponseCodeException: Response code: 403' });
  await new Promise((r) => setTimeout(r, 0));
  expect(sounds[0].unloaded).toBe(1);
  expect(sounds).toHaveLength(2);
  expect(sounds[1].init.positionMillis).toBe(4200);
  expect(urls[1]).toEqual([A, true]);
  expect(p.get('1').state).toBe('playing');
});

test('resume rejected after a long pause -> reloaded from the paused position', async () => {
  const { p, sounds } = setup();
  await p.toggle('1', A);
  await p.toggle('1', A); // pause at 3000
  (sounds[0].playAsync as jest.Mock).mockRejectedValueOnce(new Error('Player does not exist.'));
  await p.toggle('1', A);
  expect(sounds).toHaveLength(2);
  expect(sounds[1].init.positionMillis).toBe(3000);
  expect(p.get('1').state).toBe('playing');
});

test('finish -> unloaded, position 0; play again makes a new sound (fresh URL)', async () => {
  const { p, sounds, urls } = setup();
  await p.toggle('1', A);
  sounds[0].onStatus({ isLoaded: true, isPlaying: false, positionMillis: 10000, durationMillis: 10000, didJustFinish: true });
  expect(p.get('1')).toEqual({ state: 'idle', pos: 0, dur: 10000 });
  expect(sounds[0].unloaded).toBe(1);
  await p.toggle('1', A);
  expect(sounds).toHaveLength(2);
  expect(sounds[1].init.positionMillis).toBe(0);
  expect(urls).toHaveLength(2);
});

test('seek before play starts there; seek while playing moves the sound', async () => {
  const { p, sounds } = setup();
  p.setDuration('1', 10000);
  await p.seek('1', 6000);
  await p.toggle('1', A);
  expect(sounds[0].init.positionMillis).toBe(6000);
  await p.seek('1', 99999);
  expect(sounds[0].setPositionAsync).toHaveBeenCalledWith(10000);
});

test('only one note at a time: starting B stops A', async () => {
  const { p, sounds } = setup();
  await p.toggle('1', A);
  await p.toggle('2', B);
  expect(sounds[0].unloaded).toBe(1);
  expect(p.get('1').state).toBe('idle');
  expect(p.get('2').state).toBe('playing');
});

test('a slow load that loses the race to a newer tap is unloaded, never played', async () => {
  const { p, deps, sounds } = setup();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const orig = deps.resolveUrl;
  deps.resolveUrl = jest.fn(async (path: string, force: boolean) => { if (path === A) await gate; return orig(path, force); });
  const first = p.toggle('1', A);
  await p.toggle('2', B);
  release();
  await first;
  expect(sounds).toHaveLength(1); // A never created a sound after B won
  expect(p.get('2').state).toBe('playing');
  expect(p.get('1').state).toBe('idle');
});

test('no URL (not allowed / offline) -> error toast after one re-sign attempt', async () => {
  const { p, errors, urls } = setup({ urlFor: () => null });
  await p.toggle('1', A);
  expect(urls).toEqual([[A, false], [A, true]]);
  expect(p.get('1').state).toBe('error');
  expect(errors).toEqual([MSG.offline]);
});

test('local file (unsent note) plays from its file URI', async () => {
  const { p, sounds } = setup({ urlFor: (path) => path });
  await p.toggle('c1', 'file:///data/voice-outbox/c1.m4a');
  expect(sounds[0].uri).toBe('file:///data/voice-outbox/c1.m4a');
});

test('app to background pauses; release on unmount stops only its own note', async () => {
  const { p, sounds } = setup();
  await p.toggle('1', A);
  await p.pauseCurrent();
  expect(sounds[0].pauseAsync).toHaveBeenCalled();
  await p.release('2');
  expect(sounds[0].unloaded).toBe(0);
  await p.release('1');
  expect(sounds[0].unloaded).toBe(1);
});
