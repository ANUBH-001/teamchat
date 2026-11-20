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
    set({ status: 'disabled', message: 'OTA updates do not run in a dev build' });
    return 'disabled';
  }
  if (running) return state.status;
  if (state.status === 'ready') return 'ready';
  running = true;
  try {
    set({ status: 'checking', message: 'Checking for updates...' });
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) {
      set({ status: 'uptodate', message: 'App is up to date' });
    } else {
      set({ status: 'downloading', message: 'Downloading the update...' });
      const f = await Updates.fetchUpdateAsync();
      if (f.isNew) set({ status: 'ready', message: 'Update found, restarting the app', dismissed: false });
      else set({ status: 'uptodate', message: 'App is up to date' });
    }
  } catch (e) {
    set({ status: 'error', message: 'Could not check for updates. Try again in a while' });
  } finally {
    running = false;
  }
  return state.status;
}

export async function applyNow() {
  if (otaOff()) return;
  try { await Updates.reloadAsync(); } catch (e) { set({ status: 'error', message: 'Could not restart. Close the app and open it again' }); }
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
