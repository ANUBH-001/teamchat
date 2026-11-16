export type Chat = {
  id: number;
  type: 'all' | 'group' | 'dm' | 'checkin';
  name: string;
  otherUserId: number | null;
  membersCount: number;
  unread: number;
  lastMessage: null | {
    id: number;
    senderId: number;
    senderName: string;
    text: string | null;
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
  type?: 'text' | 'bot' | 'checkin_prompt'; // 'bot' = Team Assistant (AI task engine); 'checkin_prompt' = daily check-in card
  payload?: BotPayload | CheckinPromptPayload | null;
  replyTo?: ReplyRef | null; // quoted message (swipe-to-reply)
};

// Payload of a 'bot' message (server/src/ai/engine.js)
export type BotTask = {
  id: number; title: string; assigneeId: number | null; assigneeName: string | null;
  status: 'todo' | 'in_progress' | 'done'; dueDate: string | null;
};
export type BotItem = { id: number; title: string; dueDate: string | null };
export type BotPayload =
  | { kind: 'task'; replyTo: number; action: 'created' | 'completed' | 'updated'; task: BotTask; undo: 'delete' | 'status' | null }
  | {
      kind: 'summary'; replyTo: number; userId: number; userName: string;
      counts: { done: number; in_progress: number; todo: number };
      done: BotItem[]; in_progress: BotItem[]; todo: BotItem[];
    }
  | { kind: 'clarify'; replyTo: number; text: string; options: { id: number; title: string; assigneeName: string | null }[] }
  | { kind: 'info'; replyTo: number; text: string };

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
