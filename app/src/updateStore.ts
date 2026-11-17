import { useEffect, useState } from 'react';
import { SERVER_URL } from './config';
import { VERSION_CODE } from './version';

// Force-update state. Fed by GET /app/version (start + foreground) and by any 426 UPDATE_REQUIRED answer.
// Not built on api.ts (api.ts reports 426s here), so there is no import cycle.
export type VersionInfo = {
  minVersionCode: number; latestVersionCode: number; latestVersionName: string; apkUrl: string; message: string;
};
type State = { info: VersionInfo | null; forced: boolean; dismissed: boolean };

let state: State = { info: null, forced: false, dismissed: false };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };

export async function checkVersion() {
  try {
    const res = await fetch(SERVER_URL + '/app/version', { headers: { 'X-App-Version': String(VERSION_CODE) } });
    if (!res.ok) return;
    const d = await res.json();
    set({
      info: {
        minVersionCode: Number(d.minVersionCode) || 0,
        latestVersionCode: Number(d.latestVersionCode) || 0,
        latestVersionName: String(d.latestVersionName || ''),
        apkUrl: String(d.apkUrl || ''),
        message: String(d.message || ''),
      },
      forced: false,
    });
  } catch (e) {}
}

// Any API call answered 426 UPDATE_REQUIRED.
export function markUpdateRequired(apkUrl?: string, message?: string) {
  const old = state.info;
  set({
    forced: true,
    info: {
      minVersionCode: old?.minVersionCode ?? VERSION_CODE + 1,
      latestVersionCode: old?.latestVersionCode ?? VERSION_CODE + 1,
      latestVersionName: old?.latestVersionName ?? '',
      apkUrl: apkUrl || old?.apkUrl || '',
      message: old?.message || message || '',
    },
  });
}

export const dismissUpdateBanner = () => set({ dismissed: true });

// For non-React callers (auth boot): is the app blocked right now, and a way to hear changes.
export const isUpdateRequired = () =>
  state.forced || (!!state.info && VERSION_CODE < state.info.minVersionCode);
export function subscribeUpdate(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useUpdateState() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const info = state.info;
  const required = state.forced || (!!info && VERSION_CODE < info.minVersionCode);
  const available = !required && !!info && VERSION_CODE < info.latestVersionCode && !state.dismissed;
  return { info, required, available };
}
