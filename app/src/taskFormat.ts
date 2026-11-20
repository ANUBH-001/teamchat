// Round 4 Tasks tab helpers: due-line text, done-time text, grouping. Dates are 'YYYY-MM-DD' (server stores the day only).
import { Task, simpleStatus } from './taskTypes';
import { isoDay } from './dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ymdParts = (ymd: string) => { const [y, m, d] = ymd.slice(0, 10).split('-').map(Number); return { y, m, d }; };
const daysFromToday = (ymd: string) => {
  const { y, m, d } = ymdParts(ymd);
  const n = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86400000);
};
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

export const h12 = (hhmm: string) => {
  const h = +hhmm.slice(0, 2), m = hhmm.slice(3, 5);
  return ((h % 12) || 12) + (+m ? ':' + m : '') + ' ' + (h < 12 ? 'am' : 'pm');
};
const nowStr = () => { const d = new Date(); return localYmd(d.toISOString()) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
type DueSrc = { dueDate?: string | null; dueAt?: string | null };

// Small due line under a task: "Aaj 6 pm", "Kal 10 am", "Fri 5 pm", "24 Nov", "Overdue · 18 Nov 5 pm" (late), "No date".
export function dueLine(task: DueSrc, done = false): { text: string; late: boolean } {
  const dueDate = task.dueDate;
  if (!dueDate) return { text: 'No date', late: false };
  const time = task.dueAt ? ' ' + h12(task.dueAt.slice(11, 16)) : '';
  const n = daysFromToday(dueDate);
  const late = !done && (task.dueAt ? task.dueAt.slice(0, 16) < nowStr() : n < 0);
  if (late) return { text: 'Overdue · ' + dayMonth(dueDate) + time, late: true };
  if (n === 0) return { text: 'Aaj' + time, late: false };
  if (n === 1) return { text: 'Kal' + time, late: false };
  if (n > 1 && n < 7) { const { y, m, d } = ymdParts(dueDate); return { text: DOWS[new Date(y, m - 1, d).getDay()] + time, late: false }; }
  return { text: dayMonth(dueDate) + time, late: false };
}

export type Bucket = 'Overdue' | 'Today' | 'Tomorrow' | 'Upcoming' | 'No date';
export const BUCKETS: Bucket[] = ['Overdue', 'Today', 'Tomorrow', 'Upcoming', 'No date'];
export function bucketOf(task: DueSrc): Bucket {
  if (!task.dueDate) return 'No date';
  const n = daysFromToday(task.dueDate);
  if (dueLine(task).late) return 'Overdue';
  return n < 0 ? 'Overdue' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'Upcoming';
}

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

// Open lines first by due date (no date last), then by id desc.
export const byDue = (a: Line, b: Line) => {
  const da = a.task.dueAt || a.task.dueDate || '9999', db = b.task.dueAt || b.task.dueDate || '9999';
  return da === db ? b.task.id - a.task.id : da < db ? -1 : 1;
};
export const byDoneDesc = (a: Line, b: Line) => (b.doneAt || '').localeCompare(a.doneAt || '') || b.task.id - a.task.id;

export const todayYmd = () => isoDay(0);
