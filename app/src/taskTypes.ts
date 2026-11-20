// Task types (server/src/tasks.js, server/src/status.js). Round 4: only todo / done (+ closed internal); legacy keys show as todo.
// Multi-assignee with per-person status; the task is done when every assignee is done. Shown as "Task N" (= tasks.id).
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
  dueDate: string | null; // 'YYYY-MM-DD'
  dueAt?: string | null; // 'YYYY-MM-DD HH:mm' when the due has a time, else null (Round 4)
  hasTime?: boolean;
  chatId: number | null;
  sourceMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  closedAt?: string | null;
  closedBy?: number | null;
  private?: boolean; // Round 4: admin's own task, visible to its creator only
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

// Round 4: disabled (simple create->done). Old 6-step list, kept so it can come back:
// export const STEPS: StepStatus[] = ['todo', 'planning', 'coding', 'testing', 'change_merged', 'done'];
export const STEPS: StepStatus[] = ['todo', 'done'];
export const STATUSES: Status[] = [...STEPS, 'closed'];
// Round 4: legacy keys (old payloads / old rows) are plain "Pending".
export const STATUS_LABEL: Record<string, string> = {
  todo: 'Pending', done: 'Done', closed: 'Closed',
  planning: 'Pending', coding: 'Pending', testing: 'Pending', change_merged: 'Pending', in_progress: 'Pending', review: 'Pending',
};
// Round 4: disabled (simple create->done): old per-step colors
// todo '#F5A623', planning '#8E9AAF', coding '#34B7F1', testing '#A970FF', change_merged '#14B8A6', done '#25D366', closed '#6B7280'
export const STATUS_COLOR: Record<string, string> = {
  todo: '#F5A623', done: '#25D366', closed: '#6B7280',
  planning: '#F5A623', coding: '#F5A623', testing: '#F5A623', change_merged: '#F5A623', in_progress: '#F5A623', review: '#F5A623',
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

// ---- Round 4 helpers ----
// Display status: everything that is not done / closed is "todo".
export const simpleStatus = (s: string | null | undefined): 'todo' | 'done' | 'closed' => (s === 'done' ? 'done' : s === 'closed' ? 'closed' : 'todo');
export const isPrivate = (t: { private?: boolean }) => !!t.private;
// Tick = the admin (any person, or all) or an assignee (own). Closed tasks cannot be ticked.
export const canTick = (t: Task, me: Me) => !!me && t.status !== 'closed' && (me.role === 'boss' || isAssignee(t, me));
