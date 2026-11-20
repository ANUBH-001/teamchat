// Round 4: media helpers (photos now; Phase 3 voice notes / geo camera reuse them).
import { useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { Image } from 'react-native';
import { api, apiUpload, getToken } from './api';
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

// Image / Audio source URLs need the token in the query (media files are auth-protected).
let tokenCache: string | null = null;
let warming: Promise<void> | null = null;
export function warmMediaToken(): Promise<void> {
  warming = getToken().then((t) => { tokenCache = t; }).catch(() => {});
  return warming;
}
warmMediaToken();
export const clearMediaToken = () => { tokenCache = null; };

export function mediaSrc(url?: string | null): string | null {
  if (!url) return null;
  if (/^(file|content):/i.test(url)) return url; // A-12: unsent voice note plays from the local file
  const full = /^https?:/i.test(url) ? url : SERVER_URL + url;
  return tokenCache ? full + (full.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(tokenCache) : full;
}

// Hook for components: re-renders once the token is known.
export function useMediaSrc(url?: string | null): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (tokenCache || !url) return;
    let live = true;
    (warming || warmMediaToken()).then(() => { if (live) force((n) => n + 1); });
    return () => { live = false; };
  }, [url]);
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
