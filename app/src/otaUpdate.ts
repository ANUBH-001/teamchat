import { useEffect, useState } from 'react';
import * as Updates from 'expo-updates';

// Self-hosted OTA (expo-updates). Server: GET /updates/manifest. Dev builds / disabled -> no-op.
export type OtaStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error' | 'disabled';
type State = { status: OtaStatus; message: string; dismissed: boolean };

let state: State = { status: 'idle', message: '', dismissed: false };
let running = false;
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
const otaOff = () => __DEV__ || !Updates.isEnabled;

export async function checkAndFetch(): Promise<OtaStatus> {
  if (otaOff()) {
    set({ status: 'disabled', message: 'Dev build me OTA update nahi chalta' });
    return 'disabled';
  }
  if (running) return state.status;
  if (state.status === 'ready') return 'ready';
  running = true;
  try {
    set({ status: 'checking', message: 'Update check ho raha hai...' });
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) {
      set({ status: 'uptodate', message: 'App up to date hai' });
    } else {
      set({ status: 'downloading', message: 'Update download ho raha hai...' });
      const f = await Updates.fetchUpdateAsync();
      if (f.isNew) set({ status: 'ready', message: 'Update mil gaya, app restart ho rahi hai', dismissed: false });
      else set({ status: 'uptodate', message: 'App up to date hai' });
    }
  } catch (e) {
    set({ status: 'error', message: 'Update check nahi ho paya, thodi der baad try karein' });
  } finally {
    running = false;
  }
  return state.status;
}

export async function applyNow() {
  if (otaOff()) return;
  try { await Updates.reloadAsync(); } catch (e) { set({ status: 'error', message: 'Restart nahi ho paya, app band karke dobara kholein' }); }
}

export const dismissOtaBanner = () => set({ dismissed: true });

export function useOtaState() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}
