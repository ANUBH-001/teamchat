import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError } from './api';
import { Msg, Quote, ReplyRef } from './chatTypes';

// Unsent messages survive app restarts; each carries a clientId so retries never duplicate on the server.
const KEY = 'outbox';
type Item = { clientId: string; chatId: number; text: string; createdAt: string; replyTo?: ReplyRef | null; mentionIds?: number[]; quote?: Quote | null };
type SentListener = (clientId: string, message: Msg) => void;
const sentListeners = new Set<SentListener>();
let flushing = false;

async function load(): Promise<Item[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch (e) { return []; }
}
const save = (items: Item[]) => AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});

export const newClientId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function onSent(fn: SentListener) {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}

export async function pendingFor(chatId: number, senderId: number, senderName: string): Promise<Msg[]> {
  return (await load()).filter((i) => i.chatId === chatId).map((i) => ({
    clientId: i.clientId, chatId, senderId, senderName, text: i.text, deleted: false, createdAt: i.createdAt, pending: true, replyTo: i.replyTo ?? null, payload: i.quote ? ({ quote: i.quote } as any) : null,
  }));
}

export async function enqueue(chatId: number, text: string, clientId: string, createdAt: string, replyTo?: ReplyRef | null, mentionIds?: number[], quote?: Quote | null) {
  const items = await load();
  if (items.some((i) => i.clientId === clientId)) { flushOutbox(); return; } // same send twice (e.g. notification Reply)
  items.push({ clientId, chatId, text, createdAt, replyTo: replyTo ?? null, mentionIds: mentionIds && mentionIds.length ? mentionIds : undefined, quote: quote ?? undefined });
  await save(items);
  flushOutbox();
}

export async function removeFromOutbox(clientId: string) {
  await save((await load()).filter((i) => i.clientId !== clientId));
}

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of await load()) {
      try {
        const r = await api<{ message: Msg }>('POST', '/chats/' + item.chatId + '/messages', {
          text: item.text, clientId: item.clientId, replyToId: item.replyTo ? item.replyTo.id : undefined, mentionIds: item.mentionIds,
          payload: item.quote ? { quote: item.quote } : undefined, // Round 4: "Reply privately"
        });
        await removeFromOutbox(item.clientId);
        sentListeners.forEach((l) => l(item.clientId, r.message));
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
          await removeFromOutbox(item.clientId); // rejected for good (e.g. not a member)
        } else {
          break; // offline or server trouble: try again later, keep order
        }
      }
    }
  } finally {
    flushing = false;
  }
}
