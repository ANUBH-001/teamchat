import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from './api';
import { Msg, Quote, ReplyRef } from './chatTypes';

// Unsent messages survive app restarts; each carries a clientId so retries never duplicate on the server.
const KEY = 'outbox';
type Item = { clientId: string; chatId: number; text: string; createdAt: string; replyTo?: ReplyRef | null; mentionIds?: number[]; quote?: Quote | null; failed?: boolean };
type SentListener = (clientId: string, message: Msg) => void;
type FailedListener = (clientId: string) => void;
const sentListeners = new Set<SentListener>();
const failedListeners = new Set<FailedListener>();
let flushing = false;
let again = false;

// A single in-memory queue is the source of truth; every mutation runs through a promise-chain mutex and is persisted
// after each change, so enqueue and removeFromOutbox can never interleave a load/save and lose an item.
let mem: Item[] | null = null;
let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (items: Item[]) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    if (!mem) {
      try { mem = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch (e) { mem = []; }
      if (!Array.isArray(mem)) mem = [];
    }
    const r = await fn(mem!);
    try { await AsyncStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {}
    return r;
  });
  chain = run.catch(() => {});
  return run;
}
const snapshot = () => mutate((items) => items.map((i) => ({ ...i })));

/** test helper: forget in-memory state (storage is re-read on next use) */
export function _resetOutboxForTests() { mem = null; chain = Promise.resolve(); flushing = false; again = false; }

export const newClientId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function onSent(fn: SentListener) {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}
export function onFailed(fn: FailedListener) {
  failedListeners.add(fn);
  return () => { failedListeners.delete(fn); };
}

export async function pendingFor(chatId: number, senderId: number, senderName: string): Promise<Msg[]> {
  return (await snapshot()).filter((i) => i.chatId === chatId).map((i) => ({
    clientId: i.clientId, chatId, senderId, senderName, text: i.text, deleted: false, createdAt: i.createdAt, pending: !i.failed, failed: !!i.failed, replyTo: i.replyTo ?? null, payload: i.quote ? ({ quote: i.quote } as any) : null,
  }));
}

export async function enqueue(chatId: number, text: string, clientId: string, createdAt: string, replyTo?: ReplyRef | null, mentionIds?: number[], quote?: Quote | null) {
  await mutate((items) => {
    if (items.some((i) => i.clientId === clientId)) return; // same send twice (e.g. notification Reply)
    items.push({ clientId, chatId, text, createdAt, replyTo: replyTo ?? null, mentionIds: mentionIds && mentionIds.length ? mentionIds : undefined, quote: quote ?? undefined });
  });
  flushOutbox();
}

export async function removeFromOutbox(clientId: string) {
  await mutate((items) => { const i = items.findIndex((x) => x.clientId === clientId); if (i >= 0) items.splice(i, 1); });
}

/** Retry a failed item: clear its failed flag and flush again. */
export async function retryOutbox(clientId: string) {
  await mutate((items) => { const it = items.find((x) => x.clientId === clientId); if (it) it.failed = false; });
  flushOutbox();
}

export async function flushOutbox(): Promise<void> {
  if (flushing) { again = true; return; } // something was enqueued mid-flush: loop once more instead of waiting for the timer
  flushing = true;
  try {
    do {
      again = false;
      for (const item of (await snapshot()).filter((i) => !i.failed)) {
        try {
          const r = await api<{ message: Msg }>('POST', '/chats/' + item.chatId + '/messages', {
            text: item.text, clientId: item.clientId, replyToId: item.replyTo ? item.replyTo.id : undefined, mentionIds: item.mentionIds,
            payload: item.quote ? { quote: item.quote } : undefined, // Round 4: "Reply privately"
          });
          await removeFromOutbox(item.clientId);
          sentListeners.forEach((l) => l(item.clientId, r.message));
        } catch (e) {
          // 401 / 429 / 426 (update required) / 5xx / network: keep the item and retry later, in order
          const keep = !(e instanceof ApiError) || e.status < 400 || e.status >= 500 || e.status === 401 || e.status === 429 || e.status === 426 || e.status === 0;
          if (keep) break;
          // rejected for good (e.g. not a member): keep it as `failed` so the bubble shows Retry / Delete
          await mutate((items) => { const it = items.find((x) => x.clientId === item.clientId); if (it) it.failed = true; });
          failedListeners.forEach((l) => l(item.clientId));
        }
      }
    } while (again);
  } finally {
    flushing = false;
  }
}
