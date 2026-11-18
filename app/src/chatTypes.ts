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
  editedAt?: string | null; // set = bubble shows "edited"
  pending?: boolean;
  type?: 'text' | 'bot' | 'system' | 'checkin_prompt'; // 'bot' = task event card; 'system' = centered grey pill; 'checkin_prompt' = daily check-in card
  payload?: BotPayload | CheckinPromptPayload | null;
  visibleTo?: number | null; // set = only that user sees it ("Only visible to you")
  reactions?: Reaction[];
  mentions?: number[];
  mentionIds?: number[]; // outbox only: structured mentions sent with the message
  replyTo?: ReplyRef | null; // quoted message (swipe-to-reply)
};

export type Reaction = { emoji: string; userIds: number[] };

// Payload of a 'bot' message (server/src/ai/*). Old messages used `action` instead of `event` and had no ids of actors.
export type BotItem = { id: number; title: string; dueDate: string | null };
export type TaskEventName = 'created' | 'updated' | 'completed' | 'review' | 'reassigned' | 'due' | 'deleted' | 'note' | 'praise';
export type PickUser = { id: number; name: string; phoneTail: string };
export type BotPayload =
  | { kind: 'task'; event?: TaskEventName; action?: 'created' | 'completed' | 'updated'; task: Task; actorId?: number; actorName?: string; note?: string; byAi?: boolean }
  | { kind: 'picker'; command: string; text: string; tasks: { id: number; title: string; status: Status }[]; arg?: string }
  // tap = send '/' + command + (pre ? ' ' + pre : '') + ' @' + firstName + (arg ? ' ' + arg : '') with mentionIds [id]
  | { kind: 'userpicker'; command: string; text: string; users: PickUser[]; arg: string; pre: string }
  | { kind: 'ask'; task: Task; actorId: number; actorName: string; assigneeId: number }
  | { kind: 'reminder'; task: Task; days: number }
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

export type Person = { id: number; name: string; phone: string; role?: 'boss' | 'member' };

// ---- Daily check-ins (server/src/checkins.js) ----
// 'day' = morning card (open tasks, pinned, kept live); 'signoff' = evening sign-off; 'morning'/'evening' = old round-1 prompts.
export type CheckinKind = 'day' | 'signoff' | 'morning' | 'evening';
export type DayTask = {
  id: number; title: string; status: Status; dueDate: string | null; project?: string | null; overdue?: boolean; stale?: boolean; ageDays?: number;
};
export type CheckinTask = DayTask;
export type DayCounts = { given: number; done: number; left: number };
export type CheckinPromptPayload = { kind: CheckinKind; date: string; tasks: DayTask[]; counts?: DayCounts; nudge?: boolean };
export type CheckinSummary = { done: string[]; pending: string[]; blockers: string[] };
export type Checkin = {
  id: number; userId: number; date: string; kind: 'morning' | 'evening'; text: string | null; summary: CheckinSummary;
  selectedTaskIds: number[]; taskStatuses: Record<string, Status>; tasks: DayTask[];
  messageId: number | null; createdAt: string; updatedAt: string; edited: boolean;
};
export type Signoff = {
  id: number; userId: number; date: string; note: string | null; counts: DayCounts; tasks: { id: number; title: string; status: Status }[];
  messageId: number | null; createdAt: string; updatedAt: string;
};
export type CheckinSettings = {
  enabled: boolean; morningTime: string; eveningTime: string; days: number[]; nudgeMinutes: number; timezone: string;
};
export type CheckinToday = {
  date: string; chatId: number | null; settings: CheckinSettings; workday: boolean; eveningOpen: boolean;
  day: { prompted: boolean; messageId: number | null };
  signoff: { prompted: boolean; submitted: boolean; signoff: Signoff | null };
  tasks: DayTask[]; doneToday: DayTask[]; counts: DayCounts;
};
export type AdminSlot = { status: 'submitted' | 'missing'; prompted: boolean; checkin: Checkin | null };
export type AdminSignoff = { status: 'submitted' | 'missing'; prompted: boolean; signoff: Signoff | null };
export type AdminMember = { id: number; name: string; active: boolean; signoff: AdminSignoff; morning: AdminSlot; evening: AdminSlot };
export type AdminDay = { date: string; workday: boolean; members: AdminMember[] };
export type AdminUserHistory = {
  user: { id: number; name: string; active: boolean }; from: string; to: string; checkins: Checkin[]; signoffs?: Signoff[];
};
