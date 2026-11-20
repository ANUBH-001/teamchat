// Round 4 Phase 3: starred messages (local only, AsyncStorage). useStars() re-renders on change.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Quote } from './chatTypes';

export type Star = { chatId: number; messageId: number; preview: string; ts: number; senderName?: string; chatName?: string };

const KEY = 'stars.v1';
let stars: Star[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

(async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) { stars = JSON.parse(raw); emit(); }
  } catch (e) {}
})();

const save = () => AsyncStorage.setItem(KEY, JSON.stringify(stars)).catch(() => {});
export const isStarred = (chatId: number, messageId: number) => stars.some((s) => s.chatId === chatId && s.messageId === messageId);
export function toggleStar(s: Omit<Star, 'ts'>): boolean {
  const on = isStarred(s.chatId, s.messageId);
  stars = on ? stars.filter((x) => !(x.chatId === s.chatId && x.messageId === s.messageId)) : [{ ...s, ts: Date.now() }, ...stars];
  emit();
  save();
  return !on;
}
export function useStars(): Star[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => stars);
}

// "Reply privately": the quote waits here for the DM chat that is about to open (read once by ChatScreen).
const pendingQuotes = new Map<number, Quote>();
export const setPendingQuote = (dmChatId: number, q: Quote) => { pendingQuotes.set(dmChatId, q); };
export const takePendingQuote = (dmChatId: number): Quote | null => {
  const q = pendingQuotes.get(dmChatId) || null;
  pendingQuotes.delete(dmChatId);
  return q;
};
