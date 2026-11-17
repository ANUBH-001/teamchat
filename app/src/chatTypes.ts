import { Status, Task } from './taskTypes';

export type Chat = {
  id: number;
  type: 'all' | 'group' | 'dm' | 'checkin';
  name: string;
  otherUserId: number | null;
  membersCount: number;
  unread: number;
  createdBy?: number | null;
  muted?: boolean;
  pinned?: boolean;
  pinnedMessage?: { id: number; body: string; senderName: string } | null;
  myLastRead?: number | null;
  lastMessage: null | {
    id: number;
    senderId: number;
    senderName: string;
    text: string | null;
    type?: 'text' | 'bot' | 'system' | 'checkin_prompt';
    deleted: boolean;
    createdAt: string;
  };
};

export type ReplyRef = { id: number; senderName: string; text: string | null; deleted: boolean };

export type Msg = {
  id?: number; // missing while still in the outbox
  clientId: string;
  chatId: number;
  senderId: number;
  senderName: string;
  text: string | null;
  deleted: boolean;
  createdAt: string;
  pending?: boolean;
  type?: 'text' | 'bot' | 'system' | 'checkin_prompt'; // 'bot' = task event card; 'system' = centered grey pill; 'checkin_prompt' = daily check-in card
  payload?: BotPayload | CheckinPromptPayload | null;
  visibleTo?: number | null; // set = only that user sees it ("Only visible to you")
  reactions?: Reaction[];
  mentions?: number[];
  replyTo?: ReplyRef | null; // quoted message (swipe-to-reply)
};

export type Reaction = { emoji: string; userIds: number[] };

// Payload of a 'bot' message (server/src/ai/*). Old messages used `action` instead of `event` and had no ids of actors.
export type BotItem = { id: number; title: string; dueDate: string | null };
export type TaskEventName = 'created' | 'updated' | 'completed' | 'review' | 'reassigned' | 'due' | 'deleted' | 'note' | 'praise';
export type BotPayload =
  | { kind: 'task'; event?: TaskEventName; action?: 'created' | 'completed' | 'updated'; task: Task; actorId?: number; actorName?: string; note?: string; byAi?: boolean }
  | { kind: 'picker'; command: string; text: string; tasks: { id: number; title: string; status: Status }[]; arg?: string }
  | { kind: 'list'; title: string; tasks: Task[] }
  | { kind: 'help'; commands: { cmd: string; args: string; desc: string }[] }
  | { kind: 'error'; code: string; message: string }
  | {
      kind: 'summary'; userName: string;
      counts: { done: number; in_progress: number; todo: number };
      done: BotItem[]; in_progress: BotItem[]; todo: BotItem[];
    }
  | { kind: 'clarify'; text: string }
  | { kind: 'info'; text: string };

export type Person = { id: number; name: string; phone: string };

// ---- Daily check-ins (server/src/checkins.js) ----
export type CheckinKind = 'morning' | 'evening';
export type CheckinTask = { id: number; title: string; status: 'todo' | 'in_progress' | 'done'; dueDate: string | null };
export type CheckinPromptPayload = { kind: CheckinKind; date: string; tasks: CheckinTask[]; nudge?: boolean };
export type CheckinSummary = { done: string[]; pending: string[]; blockers: string[] };
export type Checkin = {
  id: number; userId: number; date: string; kind: CheckinKind; text: string | null; summary: CheckinSummary;
  selectedTaskIds: number[]; taskStatuses: Record<string, 'todo' | 'in_progress' | 'done'>; tasks: CheckinTask[];
  messageId: number | null; createdAt: string; updatedAt: string; edited: boolean;
};
export type CheckinSettings = {
  enabled: boolean; morningTime: string; eveningTime: string; days: number[]; nudgeMinutes: number; timezone: string;
};
export type CheckinSlot = { prompted: boolean; nudged: boolean; submitted: boolean; checkin: Checkin | null };
export type CheckinToday = {
  date: string; chatId: number | null; settings: CheckinSettings; workday: boolean;
  morning: CheckinSlot; evening: CheckinSlot; tasks: CheckinTask[]; eveningTasks: CheckinTask[];
};
export type AdminSlot = { status: 'submitted' | 'missing'; prompted: boolean; checkin: Checkin | null };
export type AdminDay = {
  date: string; workday: boolean;
  members: { id: number; name: string; active: boolean; morning: AdminSlot; evening: AdminSlot }[];
};
export type AdminUserHistory = { user: { id: number; name: string; active: boolean }; from: string; to: string; checkins: Checkin[] };
