import { useSyncExternalStore } from 'react';
import { api } from './api';
import { onEvent } from './realtime';
import { Task, AnyTask, isBrief } from './taskTypes';

// Round 4: current task state for chat cards (cards used to show the snapshot stored in the message).
// Filled by ws 'task' events and by a batched GET /tasks?ids=... for the cards on screen; ticks write here optimistically.
// full tasks, or briefs (member, task not viewable: title + aggregate status only, nothing private)
const cache = new Map<number, AnyTask>();
const fetchedAt = new Map<number, number>();
const subs = new Set<() => void>();
let version = 0;
const bump = () => { version++; subs.forEach((s) => s()); };

export function putTask(t: AnyTask) {
  if (!t) return;
  cache.set(t.id, t);
  bump();
}
export const getCachedTask = (id: number) => cache.get(id);
export { isBrief };

export function applyTickTo(task: Task, userId: number | null, done: boolean): Task {
  const now = new Date().toISOString();
  const has = userId != null && (task.assignees || []).some((a) => a.id === userId);
  const assignees = (task.assignees || []).map((a) => (has && a.id === userId ? { ...a, status: done ? ('done' as const) : ('todo' as const), completedAt: done ? now : null } : a));
  const all = has ? assignees.length > 0 && assignees.every((a) => a.status === 'done') : done;
  const assignees2 = !has && all ? assignees.map((a) => ({ ...a, status: 'done' as const, completedAt: a.completedAt || now })) : !has && !done ? assignees.map((a) => ({ ...a, status: 'todo' as const, completedAt: null })) : assignees;
  return { ...task, assignees: assignees2, status: task.status === 'closed' ? 'closed' : all ? 'done' : 'todo', completedAt: all ? now : null };
}

let pending = new Set<number>();
let timer: ReturnType<typeof setTimeout> | null = null;
async function flush() {
  timer = null;
  const ids = Array.from(pending); pending = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const r = await api<{ tasks: AnyTask[] }>('GET', '/tasks?ids=' + chunk.join(','));
      let any = false;
      for (const t of r.tasks || []) { cache.set(t.id, t); any = true; }
      if (any) bump();
    } catch (e) { /* keep the snapshot */ }
  }
}
// ask for the current state of a task (batched, at most once per 30 s per task)
export function ensureTask(id: number) {
  const last = fetchedAt.get(id) || 0;
  if (Date.now() - last < 30000) return;
  fetchedAt.set(id, Date.now());
  pending.add(id);
  if (!timer) timer = setTimeout(flush, 80);
}

// A-06 logout: forget every task of the previous user.
export function clearTaskCache() {
  cache.clear();
  fetchedAt.clear();
  pending = new Set();
  if (timer) { clearTimeout(timer); timer = null; }
  bump();
}

onEvent((e) => {
  if (e && e.type === 'task' && e.task) putTask(e.task as AnyTask);
});

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
// current state of task `id` (undefined until known: caller falls back to the snapshot)
export function useTaskState(id: number | null): AnyTask | undefined {
  useSyncExternalStore(subscribe, () => version);
  return id == null ? undefined : cache.get(id);
}
