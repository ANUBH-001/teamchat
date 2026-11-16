export type Status = 'todo' | 'in_progress' | 'done';
export type Task = {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: Status;
  dueDate: string | null;
};
export type UserCount = { id: number; name: string; total: number; todo: number; in_progress: number; done: number };
export type Summary = { users: UserCount[]; overall: { total: number; todo: number; in_progress: number; done: number } };
export type MineItem = { id: number; title: string; dueDate: string | null };
export type Mine = { done: MineItem[]; in_progress: MineItem[]; todo: MineItem[] };

export const STATUSES: Status[] = ['todo', 'in_progress', 'done'];
export const STATUS_LABEL: Record<Status, string> = { todo: 'Todo', in_progress: 'Doing', done: 'Done' };
export const STATUS_COLOR: Record<Status, string> = { todo: '#F5A623', in_progress: '#34B7F1', done: '#25D366' };
