// Hardening A-12: voice notes that could not be sent are kept, not lost.
// queueVoice() moves the recording out of the cache dir (documentDirectory/voice-outbox/<clientId>.m4a) and persists
// { uri, durationMs, waveform, chatId, clientId, reply, caption } in AsyncStorage BEFORE the upload, so a crash / kill
// mid-upload still leaves it. sendQueuedVoice() uploads (once: the server mediaUrl is saved) and POSTs with the SAME
// clientId on every retry (server dedupes). Failed = a voice bubble with Retry / Delete (VoiceBubble reads useVoiceState).
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { api } from './api';
import { uploadMedia } from './media';
import { Msg } from './chatTypes';

const KEY = 'voiceOutbox';
const DIR = 'voice-outbox/';
export type VoiceItem = {
  clientId: string; chatId: number; uri: string; durationMs: number; waveform: number[]; createdAt: string;
  replyToId?: number; text?: string; mentionIds?: number[];
  mediaUrl?: string; // set once the upload worked (a retry then only POSTs)
};
export type VoiceState = 'sending' | 'failed';

const inflight = new Map<string, Promise<Msg>>();
const known = new Set<string>(); // clientIds in storage (filled by load)
const stateListeners = new Set<() => void>();
const sentListeners = new Set<(clientId: string, m: Msg) => void>();
const removedListeners = new Set<(clientId: string) => void>();
let chain: Promise<unknown> = Promise.resolve(); // serialize read-modify-write on AsyncStorage

async function read(): Promise<VoiceItem[]> {
  try {
    const list: VoiceItem[] = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
    list.forEach((i) => known.add(i.clientId));
    return list;
  } catch (e) { return []; }
}
function update(fn: (items: VoiceItem[]) => VoiceItem[]): Promise<VoiceItem[]> {
  const run = chain.then(async () => {
    const next = fn(await read());
    known.clear();
    next.forEach((i) => known.add(i.clientId));
    await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
    return next;
  });
  chain = run.catch(() => {});
  return run;
}
const emitState = () => stateListeners.forEach((l) => l());

export const voiceState = (clientId?: string | null): VoiceState | null =>
  !clientId ? null : inflight.has(clientId) ? 'sending' : known.has(clientId) ? 'failed' : null;
export const isQueuedVoice = (clientId?: string | null) => !!clientId && known.has(clientId);

export function useVoiceState(clientId?: string | null): VoiceState | null {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    stateListeners.add(fn);
    return () => { stateListeners.delete(fn); };
  }, []);
  return voiceState(clientId);
}
export function onVoiceSent(fn: (clientId: string, m: Msg) => void) { sentListeners.add(fn); return () => { sentListeners.delete(fn); }; }
export function onVoiceRemoved(fn: (clientId: string) => void) { removedListeners.add(fn); return () => { removedListeners.delete(fn); }; }

export async function queueVoice(input: VoiceItem): Promise<VoiceItem> {
  let uri = input.uri;
  try {
    const dir = (FileSystem.documentDirectory || '') + DIR;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const to = dir + input.clientId + '.m4a';
    await FileSystem.moveAsync({ from: input.uri, to });
    uri = to;
  } catch (e) {} // keep the original file rather than lose it
  const item = { ...input, uri };
  await update((items) => [...items.filter((i) => i.clientId !== item.clientId), item]);
  emitState();
  return item;
}

export const voiceMsg = (i: VoiceItem, senderId: number, senderName: string): Msg => ({
  clientId: i.clientId, chatId: i.chatId, senderId, senderName, text: i.text || null, deleted: false, createdAt: i.createdAt,
  pending: true, type: 'audio', mediaUrl: i.uri, media: { kind: 'audio', durationMs: i.durationMs, waveform: i.waveform },
});

export async function voicePendingFor(chatId: number, senderId: number, senderName: string): Promise<Msg[]> {
  const list = (await read()).filter((i) => i.chatId === chatId);
  if (list.length) emitState();
  return list.map((i) => voiceMsg(i, senderId, senderName));
}

// Upload (if not yet) + POST with the item's clientId. Rejects on failure (the item stays, state 'failed').
export function sendQueuedVoice(clientId: string): Promise<Msg> {
  const running = inflight.get(clientId);
  if (running) return running;
  const p = (async () => {
    const item = (await read()).find((i) => i.clientId === clientId);
    if (!item) throw new Error('Voice note nahi mila');
    let url = item.mediaUrl;
    if (!url) {
      url = (await uploadMedia(item.uri, 'audio', 'audio/mp4')).url;
      const saved = url;
      await update((items) => items.map((i) => (i.clientId === clientId ? { ...i, mediaUrl: saved } : i)));
    }
    const res = await api<{ message: Msg }>('POST', '/chats/' + item.chatId + '/messages', {
      type: 'audio', mediaUrl: url, clientId: item.clientId, replyToId: item.replyToId,
      ...(item.text ? { text: item.text, mentionIds: item.mentionIds || [] } : {}),
      media: { kind: 'audio', durationMs: item.durationMs, waveform: item.waveform },
    });
    await forget(clientId, item.uri);
    sentListeners.forEach((l) => l(clientId, res.message));
    return res.message;
  })();
  inflight.set(clientId, p);
  emitState();
  p.catch(() => {}).finally(() => { inflight.delete(clientId); emitState(); });
  return p;
}

// Reconnect / app active: send every queued voice note, oldest first (one at a time, like text). The first failure stops
// the round (still offline: no point hammering); the bubbles stay "Nahi gaya" with Retry until the next round.
// { periodic: true } = ChatScreen's 15 s timer (the socket can stay up while HTTP fails, so no reconnect event comes):
// at most one such round per PERIODIC_MS, so a note that keeps failing is not re-uploaded every 15 s.
export const PERIODIC_MS = 60_000;
let retrying: Promise<void> | null = null;
let lastPeriodic = 0;
export function retryVoiceOutbox(opts: { periodic?: boolean } = {}): Promise<void> {
  if (retrying) return retrying;
  if (opts.periodic) {
    if (!known.size) return Promise.resolve(); // nothing queued (known is filled by read())
    if (Date.now() - lastPeriodic < PERIODIC_MS) return Promise.resolve();
    lastPeriodic = Date.now();
  }
  retrying = (async () => {
    for (const item of await read()) {
      try { await sendQueuedVoice(item.clientId); } catch (e) { break; }
    }
  })().finally(() => { retrying = null; });
  return retrying;
}

async function forget(clientId: string, uri?: string) {
  let file = uri;
  await update((items) => {
    if (!file) file = items.find((i) => i.clientId === clientId)?.uri;
    return items.filter((i) => i.clientId !== clientId);
  });
  if (file) FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
  emitState();
}

// Delete button on a failed voice bubble (or long-press Delete on it).
export async function deleteVoice(clientId: string) {
  if (inflight.has(clientId)) return; // sending right now: let it finish
  await forget(clientId);
  removedListeners.forEach((l) => l(clientId));
}

// The server already has it (ws / reload delivered the message with this clientId): drop the local copy.
export async function dropDeliveredVoice(clientId: string) {
  if (!known.has(clientId) || inflight.has(clientId)) return;
  await forget(clientId);
}

// A-06 logout: drop every queued voice note of this user and delete the recordings (the whole voice-outbox folder).
export async function clearVoiceOutbox() {
  const items = await update(() => []);
  void items;
  inflight.clear();
  await AsyncStorage.removeItem(KEY).catch(() => {});
  await FileSystem.deleteAsync((FileSystem.documentDirectory || '') + DIR, { idempotent: true }).catch(() => {});
  emitState();
}

// Tests: forget the in-memory state (what an app restart does); storage is kept.
export const __restartForTests = () => { inflight.clear(); known.clear(); chain = Promise.resolve(); retrying = null; lastPeriodic = 0; };
