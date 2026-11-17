export type Status = 'todo' | 'in_progress' | 'review' | 'done';
export type Task = {
  id: number;
  title: string;
  description: string | null;
  project: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  createdBy: number | null;
  createdByName: string | null;
  status: Status;
  dueDate: string | null;
  chatId: number | null;
  sourceMessageId: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  overdue: boolean;
};
export type UserCount = {
  id: number; name: string; total: number; todo: number; in_progress: number; review: number; done: number;
  overdue: number; doneToday: number;
};
export type Totals = { open: number; todo: number; in_progress: number; review: number; done: number; doneToday: number; overdue: number };
export type Summary = { users: UserCount[]; overall?: any; totals: Totals };

export type TaskEvent = {
  id: number; event: string; oldValue: string | null; newValue: string | null;
  actorId: number | null; actorName: string | null; source?: string; createdAt: string;
};
export type ActivityEvent = TaskEvent & { taskId: number; taskTitle: string; assigneeId: number | null; assigneeName: string | null };

export const STATUSES: Status[] = ['todo', 'in_progress', 'review', 'done'];
export const STATUS_LABEL: Record<Status, string> = { todo: 'Todo', in_progress: 'Doing', review: 'Testing', done: 'Done' };
export const STATUS_COLOR: Record<Status, string> = { todo: '#F5A623', in_progress: '#34B7F1', review: '#A970FF', done: '#25D366' };
export const OVERDUE_COLOR = '#E5484D';
