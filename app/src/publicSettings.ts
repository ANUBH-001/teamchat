import { useEffect, useState } from 'react';
import { api } from './api';
import { onEvent } from './realtime';

// Server switches every user may read (GET /settings/public). Kept fresh on the `settings` ws event.
export type PublicSettings = {
  commandsEnabled: boolean; membersCanAssign: boolean; praiseEnabled: boolean;
  quietTaskNotifs: boolean; notifyAdminOnMemberChanges: boolean;
};
let cur: PublicSettings = {
  commandsEnabled: true, membersCanAssign: true, praiseEnabled: true, quietTaskNotifs: true, notifyAdminOnMemberChanges: true,
};
const subs = new Set<() => void>();
let started = false;

export async function refreshPublicSettings() {
  try {
    cur = { ...cur, ...(await api<PublicSettings>('GET', '/settings/public')) };
    subs.forEach((f) => f());
  } catch (e) {}
}

function ensure() {
  if (started) return;
  started = true;
  refreshPublicSettings();
  onEvent((e) => { if (e.type === 'settings' || e.type === '_open') refreshPublicSettings(); });
}

export const getPublicSettings = () => { ensure(); return cur; };

export function usePublicSettings() {
  const [, tick] = useState(0);
  useEffect(() => {
    ensure();
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return cur;
}
