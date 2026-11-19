// Task types (server/src/tasks.js, server/src/status.js). Round 3: 6 steps + closed, multi-assignee with per-person status.
// The task's `status` is the aggregate (lowest step of the active assignees, done when all are done) or 'closed'.
export type Status = 'todo' | 'planning' | 'coding' | 'testing' | 'change_merged' | 'done' | 'closed';
export type StepStatus = Exclude<Status, 'closed'>;

export type Assignee = { id: number; name: string; avatarEmoji: string | null; status: StepStatus; completedAt: string | null; updatedAt?: string };

export type Task = {
  id: number;
  title: string;
  description: string | null;
  project: string | null;
  assigneeId: number | null; // primary (first) assignee
  assigneeName: string | null;
  assignees: Assignee[];
  createdBy: number | null;
  createdByName: string | null;
  status: Status;
  dueDate: string | null;
  chatId: number | null;
  sourceMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  closedAt?: string | null;
  closedBy?: number | null;
  overdue: boolean;
  ageDays?: number; // days since created
  stale?: boolean; // open and older than the reminder setting (6 days)
  remindedAt?: string | null;
  myStatus?: StepStatus; // some internal lists only
};

// What a member sees of a task they cannot open (Tasks "Everyone", chat info, DM sheet).
export type BriefTask = { id: number; title: string; status: Status; assigneeNames: string[]; assigneeIds: number[]; brief: true };
export type AnyTask = Task | BriefTask;
export const isBrief = (t: AnyTask): t is BriefTask => (t as BriefTask).brief === true;

export type UserCount = {
  id: number; name: string; avatarEmoji?: string | null; total: number; todo: number; planning: number; coding: number; testing: number;
  change_merged: number; done: number; overdue: number; doneToday: number;
};
export type Totals = {
  open: number; todo: number; planning: number; coding: number; testing: number; change_merged: number; done: number;
  doneToday: number; overdue: number; closed?: number;
};
export type Summary = { users: UserCount[]; overall?: any; totals: Totals };

export type EventSource = {
  messageId: number; chatId: number | null; chatName: string | null; chatType: string | null; senderName: string | null;
  text: string | null; replyTo: { senderName: string; text: string | null } | null; createdAt: string; available: boolean; deleted?: boolean;
};
export type TaskEvent = {
  id: number; event: string; oldValue: string | null; newValue: string | null;
  actorId: number | null; actorName: string | null; source?: any; createdAt: string;
  subjectId?: number | null; subjectName?: string | null;
};
export type DetailEvent = Omit<TaskEvent, 'source'> & { source: EventSource | null };
export type ActivityEvent = TaskEvent & {
  taskId: number; taskTitle: string; taskStatus?: Status; assigneeId: number | null; assigneeName: string | null;
};

export const STEPS: StepStatus[] = ['todo', 'planning', 'coding', 'testing', 'change_merged', 'done'];
export const STATUSES: Status[] = [...STEPS, 'closed'];
export const STATUS_LABEL: Record<string, string> = {
  todo: 'Todo', planning: 'Planning', coding: 'Coding', testing: 'Testing', change_merged: 'Change merged', done: 'Done', closed: 'Closed',
  in_progress: 'Coding', review: 'Testing', // old keys in old card payloads / sign-off JSON
};
export const STATUS_COLOR: Record<string, string> = {
  todo: '#F5A623', planning: '#8E9AAF', coding: '#34B7F1', testing: '#A970FF', change_merged: '#14B8A6', done: '#25D366', closed: '#6B7280',
  in_progress: '#34B7F1', review: '#A970FF',
};
export const OVERDUE_COLOR = '#E5484D';
export const labelOf = (s: string | null | undefined) => (s ? STATUS_LABEL[s] || s : '');
export const colorOf = (s: string | null | undefined) => (s ? STATUS_COLOR[s] || '#8E9AAF' : '#8E9AAF');
export const isOpen = (s: string) => s !== 'done' && s !== 'closed';

// Permissions mirrored from the server (server/src/tasks.js); the server always re-checks.
type Me = { id: number; role: 'boss' | 'member' } | null | undefined;
export const isAssignee = (t: Task, me: Me) => !!me && (t.assignees || []).some((a) => a.id === me.id);
export const canView = (t: Task, me: Me) => !!me && (me.role === 'boss' || isAssignee(t, me) || t.createdBy === me.id);
export const canClose = (t: Task, me: Me) => !!me && (me.role === 'boss' || t.createdBy === me.id);
export const myStatusOf = (t: Task, me: Me): StepStatus | null => {
  const a = me ? (t.assignees || []).find((x) => x.id === me.id) : null;
  return a ? a.status : null;
};
// ids of the people on a task (old payloads without assignees -> the primary)
export const assigneeIdsOf = (t: Task) => (t.assignees && t.assignees.length ? t.assignees.map((a) => a.id) : t.assigneeId ? [t.assigneeId] : []);
export const assigneeNamesOf = (t: AnyTask) =>
  isBrief(t) ? t.assigneeNames : t.assignees && t.assignees.length ? t.assignees.map((a) => a.name) : t.assigneeName ? [t.assigneeName] : [];
