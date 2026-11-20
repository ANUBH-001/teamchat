// Round 4: media helpers (photos now; Phase 3 voice notes / geo camera reuse them).
import { useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { api, apiUpload } from './api';
import { SERVER_URL } from './config';
import { newClientId } from './outbox';

export type MediaKind = 'image' | 'audio';

// Upload a local file (POST /media multipart: field "file" + "kind"). Returns the server path, e.g. /media/f/2026/11/x.jpg.
export async function uploadMedia(uri: string, kind: MediaKind, mime: string): Promise<{ url: string }> {
  const ext = (mime.split('/')[1] || (kind === 'image' ? 'jpg' : 'm4a')).replace('jpeg', 'jpg');
  const form = new FormData();
  // React Native FormData accepts {uri, name, type} for files
  form.append('file', { uri, name: kind + '.' + ext, type: mime } as any);
  form.append('kind', kind);
  const r = await apiUpload<{ url: string }>('/media', form);
  return { url: r.url };
}

// Resize to width 1600 and re-encode JPEG 0.7 (never upscales small images beyond 1600 wide: resize only when wider).
export async function compressImage(uri: string): Promise<{ uri: string; width: number; height: number }> {
  let width = 0;
  try { width = await new Promise<number>((res, rej) => Image.getSize(uri, (w) => res(w), rej)); } catch (e) {}
  const actions = !width || width > 1600 ? [{ resize: { width: 1600 } }] : [];
  const r = await ImageManipulator.manipulateAsync(uri, actions, { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: r.uri, width: r.width, height: r.height };
}

// A-07 / B-02: protected media (/media/f/..., /media/staticmap?...) is loaded through short-lived signed URLs from
// POST /media/sign (JWT in the header only, never in a URL). Paths are signed in batches and cached until 5 min before they
// expire (server TTL 30 min); useMediaSrc re-renders when a URL is (re)signed. Offline / not allowed: the plain path is
// returned (expo-image still finds it in its cache via mediaCacheKey; the server answers 401/403) and signing is retried later.
type Signed = { url: string; refreshAt: number };
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const RETRY_MS = 30 * 1000; // network error
const DENIED_MS = 5 * 60 * 1000; // no access / no such file
const BATCH_MS = 30;
const MAX_BATCH = 100; // server limit
const signedUrls = new Map<string, Signed>();
let queue = new Set<string>();
let batch: Promise<void> | null = null;
let generation = 0; // bumped by clearMediaCache: answers for the previous user are dropped

const isLocal = (url: string) => /^(file|content|data|blob):/i.test(url);
const needsSign = (url: string) => url.startsWith('/media/f/') || url.startsWith('/media/staticmap?');
const fresh = (e?: Signed) => !!e && e.refreshAt > Date.now();

async function flushSign() {
  const paths = Array.from(queue);
  queue = new Set();
  batch = null;
  const gen = generation;
  for (let i = 0; i < paths.length; i += MAX_BATCH) {
    const chunk = paths.slice(i, i + MAX_BATCH);
    try {
      const r = await api<{ urls: Record<string, string | null>; expiresAt: number }>('POST', '/media/sign', { paths: chunk });
      if (gen !== generation) return;
      for (const p of chunk) {
        const u = r.urls && r.urls[p];
        signedUrls.set(p, u ? { url: SERVER_URL + u, refreshAt: r.expiresAt - REFRESH_BEFORE_MS } : { url: SERVER_URL + p, refreshAt: Date.now() + DENIED_MS });
      }
    } catch (e) {
      if (gen !== generation) return;
      // keep a still-valid signed URL; else the plain path (cache hit only)
      for (const p of chunk) {
        const old = signedUrls.get(p);
        signedUrls.set(p, { url: old ? old.url : SERVER_URL + p, refreshAt: Date.now() + RETRY_MS });
      }
    }
  }
}
function requestSign(path: string): Promise<void> {
  queue.add(path);
  if (!batch) batch = new Promise<void>((r) => setTimeout(r, BATCH_MS)).then(flushSign);
  return batch;
}

// Logout (A-06): forget every signed URL and empty the expo-image memory + disk caches (photos of the previous user).
export async function clearMediaCache(): Promise<void> {
  generation++;
  signedUrls.clear();
  queue = new Set();
  batch = null;
  try { await Promise.all([ExpoImage.clearMemoryCache(), ExpoImage.clearDiskCache()]); } catch (e) {}
}

// A-22: expo-image cache key = the URL without the signature, so a re-signed URL is still a cache hit.
export function mediaCacheKey(url?: string | null): string | undefined {
  if (!url || isLocal(url)) return undefined;
  if (/^https?:/i.test(url)) return url;
  return SERVER_URL + (url.startsWith('/media/f/') ? url.split('?')[0] : url);
}

// Current loadable URL (sync): null while a protected path is not signed yet.
export function mediaSrc(url?: string | null): string | null {
  if (!url) return null;
  if (isLocal(url)) return url; // A-12: unsent voice note plays from the local file
  if (/^https?:/i.test(url)) return url;
  if (!needsSign(url)) return SERVER_URL + url;
  const e = signedUrls.get(url);
  return e ? e.url : null;
}

// A fresh URL right now (download, audio play): signs when needed.
// force (V-05): sign again even if a cached URL looks fresh (the player got a 403 / stream error with it).
export async function signedMediaUrl(url?: string | null, force = false): Promise<string | null> {
  if (!url) return null;
  if (needsSign(url) && (force || !fresh(signedUrls.get(url)))) await requestSign(url);
  return mediaSrc(url);
}

// Hook for components: re-renders once the URL is signed, and again when it is due for re-signing.
export function useMediaSrc(url?: string | null): string | null {
  const [tick, force] = useState(0);
  useEffect(() => {
    if (!url || !needsSign(url)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const e = signedUrls.get(url);
    if (!fresh(e)) requestSign(url).then(() => { if (live) force((n) => n + 1); });
    else timer = setTimeout(() => { if (live) force((n) => n + 1); }, Math.min(e!.refreshAt - Date.now() + 50, 2147483647));
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [url, tick]);
  return mediaSrc(url);
}

// Send a photo: compress -> upload -> POST message. Media does not use the offline outbox.
export async function sendImageToChat(chatId: number, uri: string, caption?: string, extraMedia?: Record<string, any>) {
  const img = await compressImage(uri);
  const { url } = await uploadMedia(img.uri, 'image', 'image/jpeg');
  return api('POST', '/chats/' + chatId + '/messages', {
    type: 'image', mediaUrl: url, body: caption || '', clientId: newClientId(),
    media: { kind: 'image', w: img.width, h: img.height, ...(extraMedia || {}) },
  });
}

// ---- pickers / gallery (Round 4) ----

// Open the system camera / gallery. Returns the local uri or null (cancelled / permission denied).
export async function pickPhoto(source: 'camera' | 'gallery', square = false): Promise<string | null> {
  try {
    if (source === 'camera') {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return null;
      const r = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: square, aspect: square ? [1, 1] : undefined });
      return r.canceled || !r.assets?.[0] ? null : r.assets[0].uri;
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: square, aspect: square ? [1, 1] : undefined });
    return r.canceled || !r.assets?.[0] ? null : r.assets[0].uri;
  } catch (e) {
    return null;
  }
}

// Save a photo into the gallery album "TeamChat". Asks permission; denied or any error -> silently skipped (returns false).
export async function saveToGallery(uri: string): Promise<boolean> {
  try {
    // Round 4: writeOnly=true requests nothing on Android 13+ (never saved); ask for photo access (READ_MEDIA_IMAGES) instead
    const p = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    if (!p.granted) return false;
    const asset = await MediaLibrary.createAssetAsync(uri);
    // Round 4: album move disabled - on Android 11+ it pops a system "Allow TeamChat to modify this photo?" dialog on every save; the photo lands in DCIM instead.
    // const album = await MediaLibrary.getAlbumAsync('TeamChat');
    // if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    // else await MediaLibrary.createAlbumAsync('TeamChat', asset, false);
    void asset;
    return true;
  } catch (e) {
    return false;
  }
}
