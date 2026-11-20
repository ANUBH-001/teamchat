// Round 4: small local settings store (AsyncStorage, try/catch everywhere). usePrefs() re-renders on change.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Prefs = { theme: ThemeChoice; autoTranscripts: boolean; saveToGallery: boolean };

const KEY = 'prefs.v1';
let prefs: Prefs = { theme: 'system', autoTranscripts: false, saveToGallery: true };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

(async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) { prefs = { ...prefs, ...JSON.parse(raw) }; emit(); }
  } catch (e) {}
})();

export const getPrefs = () => prefs;
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs = { ...prefs, [k]: v };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}
export function usePrefs(): Prefs {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => prefs);
}
