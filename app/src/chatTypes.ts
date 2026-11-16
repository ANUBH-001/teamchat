export type Chat = {
  id: number;
  type: 'all' | 'group' | 'dm';
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
  type?: 'text' | 'bot'; // 'bot' = Team Assistant (AI task engine)
  payload?: BotPayload | null;
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
