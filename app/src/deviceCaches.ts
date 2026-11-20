// A-06 follow-up (device test 2026-11-20): files outside our own stores that still held the last user's data after logout:
// - ImagePicker / ImageManipulator: copies of photos picked or compressed for sending
// - http-cache: the native HTTP client's (OkHttp) disk cache with API answers from before the server sent no-store.
//   Only the entry files (<key>.0 / <key>.1) go; the journal stays so the running client keeps working (a missing entry = miss).
import * as FileSystem from 'expo-file-system';

export async function clearDeviceCaches(): Promise<void> {
  const root = FileSystem.cacheDirectory;
  if (!root) return;
  const del = (p: string) => FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {});
  const jobs: Promise<unknown>[] = [del(root + 'ImagePicker'), del(root + 'ImageManipulator')];
  try {
    const dir = root + 'http-cache/';
    for (const f of await FileSystem.readDirectoryAsync(dir)) if (/\.[01]$/.test(f)) jobs.push(del(dir + f));
  } catch (e) {} // no cache dir yet
  await Promise.all(jobs);
}
