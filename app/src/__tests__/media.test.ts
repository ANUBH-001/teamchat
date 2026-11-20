// A-07 / B-02: media URLs are short-lived signed URLs from POST /media/sign; the session JWT never goes into a URL.
// A-22: expo-image cacheKey = the path without the signature, so the cache survives URL rotation.
jest.mock('../config', () => ({ SERVER_URL: 'https://srv.test' }));
jest.mock('../api', () => ({
  api: jest.fn(),
  apiUpload: jest.fn(),
  getToken: jest.fn(async () => 'SECRET.JWT.TOKEN'),
}));
jest.mock('expo-image', () => ({ Image: { clearDiskCache: jest.fn(async () => true), clearMemoryCache: jest.fn(async () => true) } }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-media-library', () => ({}));

const apiMod = require('../api');
const { Image: ExpoImage } = require('expo-image');
import { clearMediaCache, mediaCacheKey, mediaSrc, signedMediaUrl } from '../media';

const P1 = '/media/f/2026/11/a.jpg';
const P2 = '/media/f/2026/11/b.m4a';
const signedFor = (p: string, exp: number) => p + (p.includes('?') ? '&' : '?') + 'u=7&e=' + Math.floor(exp / 1000) + '&s=' + 'x'.repeat(43);
const answer = (expMs: number, deny: string[] = []) => async (_m: string, _p: string, body: any) => ({
  urls: Object.fromEntries(body.paths.map((p: string) => [p, deny.includes(p) ? null : signedFor(p, expMs)])),
  expiresAt: expMs,
});

let now = 1_800_000_000_000;
beforeEach(() => {
  clearMediaCache();
  apiMod.api.mockReset();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => { (Date.now as jest.Mock).mockRestore(); });

test('paths are signed in one batched POST /media/sign; no JWT in any URL', async () => {
  apiMod.api.mockImplementation(answer(now + 30 * 60e3));
  expect(mediaSrc(P1)).toBeNull(); // not signed yet: nothing to load
  const [u1, u2] = await Promise.all([signedMediaUrl(P1), signedMediaUrl(P2)]);
  expect(apiMod.api).toHaveBeenCalledTimes(1);
  expect(apiMod.api).toHaveBeenCalledWith('POST', '/media/sign', { paths: [P1, P2] });
  expect(u1).toBe('https://srv.test' + signedFor(P1, now + 30 * 60e3));
  expect(u2).toMatch(/^https:\/\/srv\.test\/media\/f\/2026\/11\/b\.m4a\?u=7&e=\d+&s=x{43}$/);
  expect(mediaSrc(P1)).toBe(u1);
  for (const u of [u1, u2, mediaSrc(P1)]) {
    expect(u).not.toContain('SECRET');
    expect(u).not.toMatch(/[?&]t=/);
  }
  expect(apiMod.getToken).not.toHaveBeenCalled();
  // cached: no second request
  await signedMediaUrl(P1);
  expect(apiMod.api).toHaveBeenCalledTimes(1);
});

test('re-signs 5 min before expiry', async () => {
  apiMod.api.mockImplementation(answer(now + 30 * 60e3));
  await signedMediaUrl(P1);
  now += 24 * 60e3; // 6 min left: still fresh
  await signedMediaUrl(P1);
  expect(apiMod.api).toHaveBeenCalledTimes(1);
  now += 2 * 60e3; // 4 min left: refresh
  await signedMediaUrl(P1);
  expect(apiMod.api).toHaveBeenCalledTimes(2);
});

test('offline / denied: falls back to the plain path (cache hit only), never a token URL; retried later', async () => {
  apiMod.api.mockRejectedValueOnce(new Error('Cannot reach server'));
  const u = await signedMediaUrl(P1);
  expect(u).toBe('https://srv.test' + P1);
  apiMod.api.mockImplementation(answer(now + 30 * 60e3, [P2]));
  expect(await signedMediaUrl(P2)).toBe('https://srv.test' + P2); // not allowed -> unsigned (server answers 401/403)
  now += 31e3;
  expect(await signedMediaUrl(P1)).toContain('&s=');
});

test('cacheKey ignores the signature; static map keeps its coordinates; local files pass through', () => {
  expect(mediaCacheKey(P1)).toBe('https://srv.test' + P1);
  expect(mediaCacheKey('/media/staticmap?lat=1.5&lng=2&z=16')).toBe('https://srv.test/media/staticmap?lat=1.5&lng=2&z=16');
  expect(mediaCacheKey('file:///x/y.m4a')).toBeUndefined();
  expect(mediaSrc('file:///x/y.m4a')).toBe('file:///x/y.m4a');
  expect(mediaSrc('https://other.test/p.png')).toBe('https://other.test/p.png');
  expect(mediaSrc(null)).toBeNull();
});

test('static map URLs are signed too', async () => {
  apiMod.api.mockImplementation(answer(now + 30 * 60e3));
  const p = '/media/staticmap?lat=1.5&lng=2&z=16';
  expect(await signedMediaUrl(p)).toBe('https://srv.test' + signedFor(p, now + 30 * 60e3));
});

test('clearMediaCache forgets signed URLs and clears the expo-image caches', async () => {
  apiMod.api.mockImplementation(answer(now + 30 * 60e3));
  await signedMediaUrl(P1);
  ExpoImage.clearDiskCache.mockClear(); ExpoImage.clearMemoryCache.mockClear();
  await clearMediaCache();
  expect(mediaSrc(P1)).toBeNull();
  expect(ExpoImage.clearDiskCache).toHaveBeenCalled();
  expect(ExpoImage.clearMemoryCache).toHaveBeenCalled();
});
