// Tasks tab helpers: date / time text and per-person lines. Tasks have no due date (R-07).
import { Task, simpleStatus } from './taskTypes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ymdParts = (ymd: string) => { const [y, m, d] = ymd.slice(0, 10).split('-').map(Number); return { y, m, d }; };
export const dayMonth = (ymd: string) => { const { m, d } = ymdParts(ymd); return d + ' ' + MONTHS[m - 1]; };

// Local 'YYYY-MM-DD' of an ISO timestamp.
export const localYmd = (iso: string) => {
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
export const dayYear = (ymd: string) => { const { y, m, d } = ymdParts(ymd); return d + ' ' + MONTHS[m - 1] + ' ' + y; };
// "20 Nov, 9:12 am"
export const dateTimeOf = (iso: string) => dayMonth(localYmd(iso)) + ', ' + timeOf(iso);

// One person's line on a task (a task with several people appears once per person, with that person's own tick).
export type Line = { task: Task; userId: number; name: string; done: boolean; doneAt: string | null; others: number };

export function linesOf(task: Task): Line[] {
  const a = task.assignees || [];
  if (!a.length) {
    return task.assigneeId ? [{ task, userId: task.assigneeId, name: task.assigneeName || '?', done: simpleStatus(task.status) === 'done', doneAt: task.completedAt, others: 0 }] : [];
  }
  return a.map((x) => ({
    task, userId: x.id, name: x.name, done: x.status === 'done', doneAt: x.completedAt || (x.status === 'done' ? task.completedAt : null), others: a.length - 1,
  }));
}

// Open lines newest task first.
export const byNewest = (a: Line, b: Line) => b.task.id - a.task.id;
export const byDoneDesc = (a: Line, b: Line) => (b.doneAt || '').localeCompare(a.doneAt || '') || b.task.id - a.task.id;
