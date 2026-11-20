// Device test 2026-11-20 (A-06 follow-up): after logout the app cache still held the photo picked for sending
// (ImagePicker / ImageManipulator copies) and the OkHttp disk cache entries with chat messages, tasks and people.
// clearDeviceCaches() removes them; the OkHttp journal itself is kept so the live HTTP client is not broken.
const files: Record<string, string[]> = {
  'file:///cache/http-cache/': ['journal', 'abc.0', 'abc.1', 'def.0', 'def.1'],
};
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  readDirectoryAsync: jest.fn(async (d: string) => { if (!files[d]) throw new Error('no dir'); return files[d]; }),
  deleteAsync: jest.fn(async () => {}),
}));
const FS = require('expo-file-system');
import { clearDeviceCaches } from '../deviceCaches';

beforeEach(() => jest.clearAllMocks());

test('deletes picker / manipulator copies and HTTP cache entries, keeps the journal', async () => {
  await clearDeviceCaches();
  const deleted = FS.deleteAsync.mock.calls.map((c: any[]) => c[0]).sort();
  expect(deleted).toEqual([
    'file:///cache/ImageManipulator',
    'file:///cache/ImagePicker',
    'file:///cache/http-cache/abc.0',
    'file:///cache/http-cache/abc.1',
    'file:///cache/http-cache/def.0',
    'file:///cache/http-cache/def.1',
  ]);
  for (const c of FS.deleteAsync.mock.calls) expect(c[1]).toEqual({ idempotent: true });
});

test('never throws (no http-cache dir, delete errors)', async () => {
  delete files['file:///cache/http-cache/'];
  FS.deleteAsync.mockRejectedValue(new Error('busy'));
  await expect(clearDeviceCaches()).resolves.toBeUndefined();
});
