// People store: id -> {name, avatarEmoji, role}. Filled from GET /users?includeSelf=1 (loadUsers, after login and on
// ws 'users'), updated live by ws {type:'user', user:{id,name,avatarEmoji}}. Components read it with useUser(id) /
// useUsers(); Avatar shows the emoji when one is set. Card payloads keep old name snapshots; prefer the store by id.
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { onEvent } from './realtime';

export type StoreUser = { id: number; name: string; avatarEmoji: string | null; avatarUrl?: string | null; role?: 'boss' | 'member'; showAdminLabel?: boolean; phone?: string };

let map = new Map<number, StoreUser>();
let list: StoreUser[] = [];
let version = 0;
const subs = new Set<() => void>();
const emit = () => { version++; list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name)); subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function setUser(u: Partial<StoreUser> & { id: number }) {
  const prev = map.get(u.id);
  map.set(u.id, { name: '', avatarEmoji: null, ...prev, ...u } as StoreUser);
  emit();
}

let loading: Promise<void> | null = null;
export function loadUsers(): Promise<void> {
  if (loading) return loading;
  loading = api<{ users: StoreUser[] }>('GET', '/users?includeSelf=1')
    .then((r) => {
      map = new Map(r.users.map((u) => [u.id, { ...u, avatarEmoji: u.avatarEmoji || null, avatarUrl: u.avatarUrl || null }]));
      emit();
    })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}

// A-06 logout: forget the people list (phones included).
export function clearUsers() {
  map = new Map();
  emit();
}

export const getUser = (id: number | null | undefined) => (id ? map.get(id) || null : null);
export const allUsers = () => list;

// live updates (registered once when this module loads)
onEvent((e) => {
  if (e && e.type === 'user' && e.user && e.user.id) setUser({ id: e.user.id, name: e.user.name, avatarEmoji: e.user.avatarEmoji || null, ...(e.user.avatarUrl !== undefined ? { avatarUrl: e.user.avatarUrl || null } : {}) });
  else if (e && (e.type === 'users' || e.type === '_open')) loadUsers();
});

export function useUser(id: number | null | undefined): StoreUser | null {
  return useSyncExternalStore(subscribe, () => (id ? map.get(id) || null : null));
}
export function useUsers(): StoreUser[] {
  return useSyncExternalStore(subscribe, () => list);
}
export const usersVersion = () => version;
