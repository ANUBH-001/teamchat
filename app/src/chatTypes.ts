import { Status, Task } from './taskTypes';

export type Chat = {
  id: number;
  type: 'all' | 'group' | 'dm' | 'checkin';
  name: string;
  otherUserId: number | null;
  otherUserEmoji?: string | null;
  membersCount: number;
  unread: number;
  createdBy?: number | null;
  muted?: boolean;
  pinned?: boolean;
  favourite?: boolean; // Round 4: PATCH /chats/:id/me {favourite}
  pinnedMessage?: { id: number; body: string; senderName: string } | null;
  myLastRead?: number | null;
  lastMessage: null | {
    id: number;
    senderId: number;
    senderName: string;
    text: string | null;
    type?: 'text' | 'bot' | 'system' | 'checkin_prompt' | 'image' | 'audio';
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
  senderEmoji?: string | null;
  text: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt?: string | null;
  sourceMessageId?: number | null; // bot card: the human message that caused it (shown attached under it)
  taskId?: number | null; // card / command / "#N" message / reply in a task reply chain // set = bubble shows "edited"
  pending?: boolean;
  failed?: boolean; // outbox: rejected by the server, shows Retry / Delete
  type?: 'text' | 'bot' | 'system' | 'checkin_prompt' | 'image' | 'audio'; // 'bot' = task event card; 'system' = centered grey pill; 'checkin_prompt' = daily check-in card
  payload?: BotPayload | CheckinPromptPayload | CheckinSummaryPayload | null;
  visibleTo?: number | null; // set = only that user sees it ("Only visible to you")
  reactions?: Reaction[];
  mentions?: number[];
  mentionIds?: number[]; // outbox only: structured mentions sent with the message
  replyTo?: ReplyRef | null; // quoted message (swipe-to-reply)
  // Round 4: media. payload.quote ("Reply privately") and payload.kind 'ai_answer' are read via casts (see Bubble.tsx)
  mediaUrl?: string | null; // /media/f/... (image / audio)
  media?: MediaInfo | null;
  senderAvatarUrl?: string | null;
};

export type MediaInfo = {
  kind: 'image' | 'audio' | 'geo_image'; w?: number; h?: number; durationMs?: number; waveform?: number[];
  lat?: number; lng?: number; address?: string; takenAt?: string;
  transcript?: string; transcriptStatus?: 'pending' | 'done' | 'failed';
};
// "Reply privately": payload.quote on the first message of the new DM (senderName already = "<sender> · <group name>")
export type Quote = { chatId: number; messageId: number; senderName: string; text: string };

export type Reaction = { emoji: string; userIds: number[] };

// Payload of a 'bot' message (server/src/ai/*). Old messages used `action` instead of `event` and had no ids of actors.
export type BotItem = { id: number; title: string };
export type TaskEventName =
  | 'created' | 'updated' | 'completed' | 'review' | 'reassigned' | 'due' | 'deleted' | 'note' | 'praise'
  | 'planning' | 'coding' | 'testing' | 'change_merged' | 'done' | 'closed' | 'reopened' | 'answered';
export type PickUser = { id: number; name: string; phoneTail: string };
export type BotPayload =
  | {
      kind: 'task'; event?: TaskEventName; action?: 'created' | 'completed' | 'updated'; task: Task; actorId?: number; actorName?: string;
      note?: string; byAi?: boolean; replyTo?: number; undo?: 'status' | 'delete' | null; edited?: boolean;
    }
  | { kind: 'picker'; command: string; text: string; tasks: { id: number; title: string; status: Status }[]; arg?: string }
  // tap = send '/' + command + (pre ? ' ' + pre : '') + ' @' + firstName + (arg ? ' ' + arg : '')
  // with mentionIds [...keep ids, id] (keep = people already resolved in the same command; their '@Name' labels are in pre)
  | { kind: 'userpicker'; command: string; text: string; users: PickUser[]; arg: string; pre: string; keep?: { label: string; id: number }[] }
  | {
      kind: 'ask'; task: Task; actorId: number; actorName: string; assigneeId: number; assigneeIds?: number[]; askId?: number; askerId?: number;
      replyTo?: number;
    }
  | { kind: 'reminder'; task: Task; days: number; assigneeId?: number }
  | {
      kind: 'list'; title: string;
      tasks: { id: number; title: string; status: Status; assigneeName: string | null; brief?: boolean }[];
    }
  | { kind: 'help'; commands: { cmd: string; args: string; desc: string }[] }
  | { kind: 'error'; code: string; message: string }
  | {
      kind: 'summary'; userName: string;
      // round 3 keys: todo, planning, coding, testing, change_merged, done (old cards: in_progress, review)
      counts: Record<string, number>;
      [status: string]: any;
    }
  | { kind: 'clarify'; text: string }
  | { kind: 'info'; text: string };

export type Person = { id: number; name: string; phone: string; role?: 'boss' | 'member'; avatarEmoji?: string | null };

// ---- Daily check-ins (server/src/checkins.js) ----
// 'day' = morning card (open tasks, pinned, kept live); 'signoff' = evening sign-off; 'morning'/'evening' = old round-1 prompts.
export type CheckinKind = 'day' | 'signoff' | 'morning' | 'evening' | 'summary';
// status = the member's OWN status on the task; taskStatus = the task's aggregate
export type DayTask = {
  id: number; title: string; status: Status; project?: string | null; stale?: boolean; ageDays?: number;
  taskStatus?: Status; assigneeCount?: number; createdBy?: number | null; description?: string | null;
};
export type CheckinTask = DayTask;
export type DayCounts = { given: number; done: number; left: number };
export type CheckinPromptPayload = { kind: CheckinKind; date: string; tasks: DayTask[]; counts?: DayCounts; nudge?: boolean; picks?: number[] };
// admins' evening summary (kind 'summary'), kept live by the server
export type CheckinSummaryMember = {
  id: number; name: string; replied: boolean; picks: { id: number; title: string; status: Status }[]; done: { id: number; title: string }[];
  morning: string | null; report: string | null; open: number;
};
export type CheckinSummaryPayload = {
  kind: 'summary'; date: string; members: CheckinSummaryMember[]; totals: { members: number; replied: number; done: number; picked: number };
};
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
  enabled: boolean; morningTime: string; eveningTime: string; days: number[]; nudgeMinutes: number; timezone: string; summaryTime?: string;
};
export type CheckinToday = {
  date: string; chatId: number | null; settings: CheckinSettings; workday: boolean; eveningOpen: boolean;
  day: { prompted: boolean; messageId: number | null };
  signoff: { prompted: boolean; submitted: boolean; signoff: Signoff | null };
  tasks: DayTask[]; doneToday: DayTask[]; counts: DayCounts; picks?: number[];
};
export type AdminSlot = { status: 'submitted' | 'missing'; prompted: boolean; checkin: Checkin | null };
export type AdminSignoff = { status: 'submitted' | 'missing'; prompted: boolean; signoff: Signoff | null };
export type AdminMember = { id: number; name: string; active: boolean; signoff: AdminSignoff; morning: AdminSlot; evening: AdminSlot };
export type AdminDay = { date: string; workday: boolean; members: AdminMember[] };
export type AdminUserHistory = {
  user: { id: number; name: string; active: boolean }; from: string; to: string; checkins: Checkin[]; signoffs?: Signoff[];
};
