import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform, AppState, ActivityIndicator, ScrollView, Modal,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat, Msg, Quote, ReplyRef, Reaction } from '../chatTypes';
import { AnyTask, assigneeIdsOf, assigneeNamesOf, colorOf, isBrief, isOpen, labelOf, Task } from '../taskTypes';
import { loadUsers as loadStoreUsers, useUsers } from '../userStore';
import { onEvent, sendTyping } from '../realtime';
import { shouldSend } from '../sendGuard';
import { enqueue, flushOutbox, newClientId, onFailed, onSent, pendingFor, removeFromOutbox, retryOutbox } from '../outbox';
import { COMMANDS, Command, DUE_CHIPS, QUICK } from '../commands';
import { CommandSheet, firstName, PeopleSheet, PersonAction, PersonSheet, phoneTail, PickPerson } from '../components/ComposerSheets';
import { usePublicSettings } from '../publicSettings';
import Avatar from '../components/Avatar';
import Bubble, { FWD, isTaskCard } from '../components/Bubble';
import Sheet, { SheetRow } from '../components/Sheet';
import Suggestions, { Suggestion } from '../components/Suggestions';
import { TickStatus } from '../components/Tick';
// Round 4: old speech-to-text mic no longer used: import VoiceBar, { MicButton } from '../components/VoiceBar';
import Composer from '../components/Composer';
import AttachSheet from '../components/AttachSheet';
import PhotoPreviewPanel, { PreviewItem } from '../components/PhotoPreviewPanel';
import ImageViewer from '../components/ImageViewer';
import { MediaGridModal } from '../components/MediaGrid';
import SendToSheet from '../components/SendToSheet';
import GeoCameraScreen from './GeoCameraScreen';
import { VoiceResult } from '../components/VoiceRecorder';
import { sendImageToChat, uploadMedia } from '../media';
import { setPendingQuote, takePendingQuote, toggleStar, useStars } from '../starStore';
import { copyText } from '../dates';
import TaskActionSheet from '../components/TaskActionSheet';
import TaskModal from '../components/TaskModal';
import DmTasksSheet from '../components/DmTasksSheet';
import InAppBanner from '../components/InAppBanner';
import { toast } from '../useVoiceInput'; // Round 4: useVoiceInput is no longer used (voice notes use expo-av)

type Item =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'msg'; key: string; msg: Msg; attachments?: Msg[]; quote?: string | null };
type Kind = 'all' | 'ai' | 'chat'; // group filter: AI = bot cards only, Chat = human text only
// one sheet closes, the next opens: wait for the closing Modal's fade (Android drops a Modal shown while another is dismissing)
const SHEET_GAP = 350;
const kindByChat = new Map<number, Kind>(); // filter remembered per chat (memory only)
const drafts = new Map<number, { text: string; refs: { id: number; label: string }[] }>(); // unsent composer text per chat
const isHuman = (m: Msg) => !m.type || m.type === 'text' || m.type === 'image' || m.type === 'audio'; // Round 4: media is human too
// "📷 Photo" / "🎤 Voice note" for media messages (reply previews, quotes, stars); '' for text
const mediaLabel = (m: Msg) => (m.type === 'image' ? (m.media?.kind === 'geo_image' ? '📍 Photo' : '📷 Photo') : m.type === 'audio' ? '🎤 Voice note' : '');
const plainText = (m: Msg) => (m.text || '').replace(/^↪ Forwarded\n?/, '');
const previewOf = (m: Msg) => plainText(m) || mediaLabel(m);
const TASK_CMD_ME = /^\/(task|assign|unassign|reassign|re)\b/i; // inline "@" offers me only after these
const idsOfAny = (x: AnyTask) => (isBrief(x) ? x.assigneeIds : assigneeIdsOf(x));
type Member = { id: number; name: string; role: 'boss' | 'member'; isCreator: boolean; phone?: string };
type MentionRef = { id: number; label: string }; // "@Rishit" inserted from a picker, sent as structured mentionIds
const EDIT_MS = 10 * 60 * 1000; // server allows edit/delete of own messages for 10 minutes

// Structured mention ids for the text, in text order (each inserted label is matched to its next occurrence).
function mentionIdsFor(text: string, refs: MentionRef[]) {
  const found: { pos: number; id: number }[] = [];
  const cursor: Record<string, number> = {};
  for (const r of refs) {
    const pos = text.indexOf(r.label, cursor[r.label] ?? 0);
    if (pos < 0) continue;
    cursor[r.label] = pos + r.label.length;
    found.push({ pos, id: r.id });
  }
  return found.sort((a, b) => a.pos - b.pos).map((f) => f.id);
}
const canDeleteMedia = (m: Msg, meId: number) =>
  !!m.id && !m.deleted && m.senderId === meId && (m.type === 'image' || m.type === 'audio') && m.visibleTo == null &&
  Date.now() - new Date(m.createdAt).getTime() < EDIT_MS;
const canEditMsg = (m: Msg, meId: number) =>
  // Round 4: own photo / voice-note captions can be edited too (server PATCH allows it)
  !!m.id && !m.deleted && m.senderId === meId && (!m.type || m.type === 'text' || m.type === 'image' || m.type === 'audio') && m.visibleTo == null &&
  Date.now() - new Date(m.createdAt).getTime() < EDIT_MS;

const EMOJIS = ['👍', '✅', '🙏', '😂', '❤️', '👀'];

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// merge by id / clientId, keep order by (id, else time)
function merge(list: Msg[], incoming: Msg[]): Msg[] {
  const out = [...list];
  for (const m of incoming) {
    const i = out.findIndex((x) => (m.id && x.id === m.id) || (!!m.clientId && x.clientId === m.clientId));
    if (i >= 0) out[i] = { ...out[i], ...m, pending: false };
    else out.push(m);
  }
  return out.sort((a, b) => {
    if (a.id && b.id) return a.id - b.id;
    if (!a.id && !b.id) return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return a.id ? -1 : 1; // unsent go last
  });
}

type Props = {
  chat: Chat;
  onBack: () => void;
  onOpenInfo: (c: Chat) => void;
  onOpenTask: (id: number) => void;
  onOpenChat: (c: Chat) => void; // "Message privately"
  focusId?: number | null; // scroll to this message once loaded (ask banner / notification / "Chat mein dekho")
};

export default function ChatScreen({ chat, onBack, onOpenInfo, onOpenTask, onOpenChat, focusId }: Props) {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const insets = useSafeAreaInsets();
  const me = user!;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState({ delivered: 0, read: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState(() => drafts.get(chat.id)?.text || '');
  // Round 4: latest typed text, so a Send tap right after typing (before React re-rendered) still sends it
  const textRef = useRef(text);
  textRef.current = text;
  const lastSend = useRef<{ text: string; at: number } | null>(null);
  const filterable = chat.type === 'group' || chat.type === 'all';
  const [kind, setKind] = useState<Kind>(() => {
    const k = filterable ? kindByChat.get(chat.id) || 'all' : 'all';
    return focusId && k === 'chat' ? 'all' : k; // the target may be a bot card
  });
  const kindRef = useRef<Kind>(kind);
  const kq = () => (kindRef.current === 'all' ? '' : '&kind=' + kindRef.current);
  // own messages sent while a filter is on: stay visible (AI mode) until the filter changes, instead of vanishing on delivery
  const sentHere = useRef(new Set<string>());
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [menu, setMenu] = useState<Msg | null>(null);
  const [pinned, setPinned] = useState(chat.pinnedMessage ?? null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myTasks, setMyTasks] = useState<AnyTask[] | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [belowCount, setBelowCount] = useState(0);
  // composer helpers: "/" sheet, "@" people sheet -> person actions, structured mentions, edit mode
  const [sheet, setSheet] = useState<null | 'cmd' | 'people' | 'person' | 'dmTasks' | 'newTask'>(null);
  const [peopleTitle, setPeopleTitle] = useState('');
  const peoplePick = useRef<((p: PickPerson) => void) | null>(null);
  const peoplePickMany = useRef<((ps: PickPerson[]) => void) | null>(null);
  const [peopleOpts, setPeopleOpts] = useState({ includeMe: false, multi: false });
  const storeUsers = useUsers();
  const [chipTask, setChipTask] = useState<number | null>(null); // "#N" chip -> TaskActionSheet
  const [person, setPerson] = useState<PickPerson | null>(null);
  const [personTasks, setPersonTasks] = useState<Task[] | null>(null);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState<Msg | null>(null);
  const refs = useRef<MentionRef[]>(drafts.get(chat.id)?.refs || []);
  const [askTasks, setAskTasks] = useState<AnyTask[] | null>(null);
  // Round 4 Phase 3: header menu, search, media, attach / photo preview / geo camera, viewer, forward, info, quote, uploads
  const [headMenu, setHeadMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchPos, setSearchPos] = useState(0); // 0 = newest match
  const [mediaOpen, setMediaOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [previewUris, setPreviewUris] = useState<string[] | null>(null);
  const [geoOpen, setGeoOpen] = useState(false);
  const [viewMsg, setViewMsg] = useState<Msg | null>(null);
  const [fwdMsg, setFwdMsg] = useState<Msg | null>(null);
  const [fwdChats, setFwdChats] = useState<Chat[]>([]);
  const [infoMsg, setInfoMsg] = useState<Msg | null>(null);
  const [quote, setQuote] = useState<Quote | null>(() => takePendingQuote(chat.id)); // "Reply privately" waiting for the next message
  const [uploading, setUploading] = useState(0);
  const [mutedL, setMutedL] = useState(!!chat.muted);
  const [peopleSrc, setPeopleSrc] = useState<PickPerson[] | null>(null); // custom list for the people sheet (old assignees of /re)
  const stars = useStars();
  const starIds = useMemo(() => new Set(stars.filter((x) => x.chatId === chat.id).map((x) => x.messageId)), [stars, chat.id]);
  const listRef = useRef<FlatList<Item>>(null);
  const inputRef = useRef<TextInput>(null);
  const loadingOlder = useRef(false);
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const atBottom = useRef(true);
  // "Unread messages" divider: where my read pointer was when the chat was opened
  const unreadFrom = useRef<number | null>(chat.unread > 0 ? chat.myLastRead ?? 0 : null);
  const [typingName, setTypingName] = useState<string | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;
  // newest id received from the server stream (history or WebSocket). Not raised by our own HTTP send,
  // which can succeed while the socket is still down, so a reconnect still fetches what we missed.
  const syncedId = useRef(0);
  const synced = (list: Msg[]) => { for (const m of list) if (m.id && m.id > syncedId.current) syncedId.current = m.id; };

  const markRead = useCallback(() => { api('POST', '/chats/' + chat.id + '/read', {}).catch(() => {}); }, [chat.id]);

  const loadMembers = useCallback(async () => {
    if (chat.type === 'checkin') return;
    try { setMembers((await api<{ members: Member[] }>('GET', '/chats/' + chat.id)).members); } catch (e) {}
  }, [chat.id, chat.type]);

  const loadLatest = useCallback(async () => {
    const k = kindRef.current;
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean; status: any }>('GET', '/chats/' + chat.id + '/messages?limit=30' + kq());
      if (kindRef.current !== k) return; // filter changed meanwhile
      const pend = await pendingFor(chat.id, me.id, me.name);
      synced(r.messages);
      setMsgs((cur) => merge(merge(cur, r.messages), pend));
      setHasMore(r.hasMore);
      setStatus(r.status);
      markRead();
    } catch (e) {}
    setLoaded(true);
  }, [chat.id, me.id, me.name, markRead]);

  const loadMissed = useCallback(async () => {
    const last = syncedId.current;
    if (!last) return loadLatest();
    try {
      const k = kindRef.current;
      const r = await api<{ messages: Msg[]; status: any }>('GET', '/chats/' + chat.id + '/messages?after=' + last + kq());
      if (kindRef.current !== k) return;
      synced(r.messages);
      setMsgs((cur) => merge(cur, r.messages));
      setStatus(r.status);
      markRead();
    } catch (e) {}
  }, [chat.id, loadLatest, markRead]);

  const loadOlder = useCallback(async () => {
    const first = msgsRef.current.find((m) => m.id)?.id;
    if (!hasMoreRef.current || !first || loadingOlder.current) return;
    loadingOlder.current = true;
    setLoadingMore(true);
    const k = kindRef.current;
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean }>('GET', '/chats/' + chat.id + '/messages?limit=30&before=' + first + kq());
      if (kindRef.current === k) {
        setMsgs((cur) => merge(cur, r.messages));
        setHasMore(r.hasMore);
      }
    } catch (e) {}
    loadingOlder.current = false;
    setLoadingMore(false);
  }, [chat.id]);

  // original message was deleted: update quotes that point to it
  const markDeleted = useCallback((id: number) => {
    setMsgs((cur) => cur.map((m) =>
      m.id === id ? { ...m, deleted: true }
        : m.replyTo && m.replyTo.id === id ? { ...m, replyTo: { ...m.replyTo, deleted: true, text: null } } : m));
    setReplyTo((r) => (r && r.id === id ? null : r));
  }, []);

  const setReactions = useCallback((id: number, reactions: Reaction[]) => {
    setMsgs((cur) => cur.map((m) => (m.id === id ? { ...m, reactions } : m)));
  }, []);

  useEffect(() => {
    loadLatest();
    loadMembers();
    flushOutbox();
    const offSent = onSent((clientId, message) => {
      if (message.chatId === chat.id) setMsgs((cur) => merge(cur, [message]));
    });
    const offFailed = onFailed((clientId) => setMsgs((cur) => cur.map((m) => (m.clientId === clientId && !m.id ? { ...m, pending: false, failed: true } : m))));
    const off = onEvent((e) => {
      if (e.type === '_open') { loadMissed(); flushOutbox(); }
      else if (e.type === 'message' && e.message.chatId === chat.id) {
        synced([e.message]);
        setMsgs((cur) => merge(cur, [e.message]));
        if (e.message.senderId !== me.id) {
          markRead();
          if (!atBottom.current) setBelowCount((n) => n + 1);
        }
      } else if (e.type === 'edited' && e.chatId === chat.id && e.message) {
        setMsgs((cur) => cur.map((m) => (m.id === e.message.id
          ? { ...m, ...e.message, reactions: e.message.reactions?.length ? e.message.reactions : m.reactions } : m)));
      } else if (e.type === 'reset' || e.type === 'purged') {
        // admin reset / weekly purge: start this chat fresh (a reset removes groups and DMs entirely)
        syncedId.current = 0;
        setMsgs([]);
        setPinned(null);
        if (e.type === 'reset' && (chat.type === 'group' || chat.type === 'dm')) { onBack(); return; }
        loadLatest();
      } else if (e.type === 'deleted' && e.chatId === chat.id) {
        markDeleted(e.messageId);
      } else if (e.type === 'read' && e.chatId === chat.id) {
        setStatus({ delivered: e.delivered, read: e.read });
      } else if (e.type === 'reaction' && e.chatId === chat.id) {
        setReactions(e.messageId, e.reactions || []);
      } else if (e.type === 'pin' && e.chatId === chat.id) {
        setPinned(e.pinnedMessage ?? null);
      } else if (e.type === 'chat' && e.chatId === chat.id) {
        if (e.removed) { Alert.alert('Removed', 'You are no longer in this group.'); onBack(); }
        else loadMembers();
      } else if (e.type === 'typing' && e.chatId === chat.id && e.userId !== me.id) {
        setTypingName(e.name);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTypingName(null), 3000);
      }
    });
    const retry = setInterval(flushOutbox, 15000);
    const app = AppState.addEventListener('change', (st) => { if (st === 'active') { loadMissed(); flushOutbox(); } });
    return () => { off(); offSent(); offFailed(); app.remove(); clearInterval(retry); if (typingTimer.current) clearTimeout(typingTimer.current); };
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeKind = (k: Kind) => {
    if (k === kindRef.current) return;
    kindByChat.set(chat.id, k);
    kindRef.current = k;
    sentHere.current.clear();
    setKind(k);
    syncedId.current = 0;
    setMsgs([]);
    setHasMore(false);
    setLoaded(false);
    loadLatest();
  };

  // draft per chat (memory): leaving and coming back keeps unsent text
  useEffect(() => {
    if (!editing) drafts.set(chat.id, { text, refs: refs.current });
  }, [text, editing, chat.id]);

  // Round 4: const voice = useVoiceInput(); (old speech-to-text, removed from the UI)

  const send = (raw = text, keepReply = false, ids?: number[]) => {
    const body = raw.trim();
    if (!body) return;
    if (!keepReply && !shouldSend(lastSend.current, body, Date.now())) return; // double-tap guard
    if (!keepReply) lastSend.current = { text: body, at: Date.now() };
    if (editing && !keepReply) { saveEdit(body); return; }
    const mentionIds = ids ?? (keepReply ? [] : mentionIdsFor(body, refs.current));
    const clientId = newClientId();
    sentHere.current.add(clientId);
    const createdAt = new Date().toISOString();
    const rt = keepReply ? null : replyTo;
    const ref: ReplyRef | null = rt && rt.id
      ? { id: rt.id, senderName: rt.senderName, text: (previewOf(rt) || '').slice(0, 200), deleted: false }
      : null;
    setMsgs((cur) => merge(cur, [{
      clientId, chatId: chat.id, senderId: me.id, senderName: me.name, text: body, deleted: false, createdAt, pending: true,
      replyTo: ref, payload: !keepReply && quote ? ({ quote } as any) : null,
    }]));
    const q = keepReply ? null : quote;
    if (!keepReply) { textRef.current = ''; setText(''); setReplyTo(null); setQuote(null); refs.current = []; }
    enqueue(chat.id, body, clientId, createdAt, ref, mentionIds, q);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  // stable props for the memoized Bubble (cards re-send commands / prefill the composer)
  const onSendText = useCallback((x: string, ids?: number[]) => sendRef.current(x, true, ids), []);
  const openTaskRef = useRef(onOpenTask);
  openTaskRef.current = onOpenTask;
  const openTask = useCallback((id: number) => openTaskRef.current(id), []);
  const onTaskChip = useCallback((id: number) => setChipTask(id), []);
  const openImage = useCallback((m: Msg) => setViewMsg(m), []);

  const saveEdit = async (body: string) => {
    const m = editing;
    if (!m || !m.id) return;
    if (body === m.text) { cancelEdit(); return; }
    try {
      const r = await api<{ message: Msg }>('PATCH', '/messages/' + m.id, { text: body, mentionIds: mentionIdsFor(body, refs.current) });
      setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, ...r.message } : x)));
      cancelEdit();
    } catch (e: any) { Alert.alert('Edit nahi hua', e.message); }
  };
  const cancelEdit = () => { setEditing(null); setText(''); refs.current = []; };
  const startEdit = (m: Msg) => {
    setReplyTo(null);
    setEditing(m);
    setText(m.text || '');
    refs.current = [];
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  // ---- composer: insert text / mentions, people + command sheets ----
  const put = useCallback((v: string) => { setText(v); setTimeout(() => inputRef.current?.focus(), 80); }, []);
  const withMention = (base: string, p: PickPerson) => {
    const label = '@' + firstName(p.name);
    refs.current = [...refs.current, { id: p.id, label }];
    return base + (base && !/\s$/.test(base) ? ' ' : '') + label + ' ';
  };
  const withMentions = (base: string, ps: PickPerson[]) => ps.reduce((acc, p) => withMention(acc, p), base);
  // people from the user store (GET /users?includeSelf=1) + chat members; me is never in this list (pinned row instead)
  const pickList: PickPerson[] = useMemo(() => {
    const inChat = new Set(members.map((m) => m.id));
    const byId = new Map<number, PickPerson>();
    for (const m of members) if (m.id !== me.id) byId.set(m.id, { id: m.id, name: m.name, phone: m.phone, role: m.role, inChat: true });
    for (const u of storeUsers) if (u.id !== me.id && !byId.has(u.id)) byId.set(u.id, { id: u.id, name: u.name, phone: u.phone, role: u.role, inChat: inChat.has(u.id) });
    return [...byId.values()];
  }, [members, storeUsers, me.id]);
  const mePerson: PickPerson = useMemo(() => ({ id: me.id, name: me.name, phone: me.phone, role: me.role, inChat: true }), [me.id, me.name, me.phone, me.role]);
  // includeMe: task / assign / reassign / tasks pickers offer "Me (khud)" first (bug 1)
  const openPeople = (title: string, onPick: (p: PickPerson) => void, includeMe = false, src: PickPerson[] | null = null) => {
    setPeopleSrc(src);
    peoplePick.current = onPick;
    peoplePickMany.current = null;
    setPeopleTitle(title);
    setPeopleOpts({ includeMe, multi: false });
    if (!storeUsers.length) loadStoreUsers();
    setSheet('people');
  };
  const openPeopleMany = (title: string, onPick: (ps: PickPerson[]) => void, includeMe = true) => {
    setPeopleSrc(null);
    peoplePick.current = null;
    peoplePickMany.current = onPick;
    setPeopleTitle(title);
    setPeopleOpts({ includeMe, multi: true });
    if (!storeUsers.length) loadStoreUsers();
    setSheet('people');
  };
  const pickedPerson = (p: PickPerson) => {
    const fn = peoplePick.current;
    peoplePick.current = null;
    setSheet(null);
    if (fn) setTimeout(() => fn(p), SHEET_GAP);
  };
  const pickedPeople = (ps: PickPerson[]) => {
    const fn = peoplePickMany.current;
    peoplePickMany.current = null;
    setSheet(null);
    if (fn && ps.length) setTimeout(() => fn(ps), SHEET_GAP);
  };
  // "@" button: person -> their open tasks + actions
  const openPersonActions = () => openPeople('Kisko? (task, status, mention)', (p) => {
    setPerson(p);
    setPersonTasks(null);
    setSheet('person');
    api<{ tasks: Task[] }>('GET', '/tasks?assignee=' + p.id)
      .then((r) => setPersonTasks(r.tasks.filter((x) => isOpen(x.status)))).catch(() => setPersonTasks([]));
  }, true);
  // /assign /unassign /reassign #id -> people (several allowed, me included)
  const PEOPLE_CMD: Record<string, string> = { reassign: 'Kisko dena hai?', assign: 'Kisko jodna hai?', unassign: 'Kisko hatana hai?', re: 'Kisko dena hai?' };
  const pickPeopleFor = (cmd: string, base: string) =>
    openPeopleMany(PEOPLE_CMD[cmd] || 'Kaun?', (tos) => { refs.current = []; put(withMentions(base, tos)); });
  // Round 4: /re -> task picked -> (several assignees: whose place?) -> new person(s) => "/re #N @Old @New" (single assignee: "/re #N @New")
  const startReassign = (x: AnyTask) => {
    const ids = idsOfAny(x);
    const names = assigneeNamesOf(x);
    const base = '/re #' + x.id + ' ';
    const askNew = (olds: PickPerson[]) =>
      openPeopleMany('Kisko dena hai?', (tos) => { refs.current = []; put(withMentions(withMentions(base, olds), tos)); });
    if (ids.length <= 1) { askNew([]); return; }
    const olds: PickPerson[] = ids.map((id, i) => ({ id, name: names[i] || 'User ' + id }));
    openPeople('Kis ki jagah? (purana)', (p) => askNew([p]), false, olds);
  };
  const personAction = (a: PersonAction, task: Task | null) => {
    const p = person;
    setSheet(null);
    if (!p) return;
    const id = task ? '#' + task.id : '';
    setTimeout(() => {
      if (a === 'mention') put(withMention(text, p));
      else if (a === 'task') { refs.current = []; put(withMention('/task ', p)); }
      else if (a === 'ask') put('/ask ' + id);
      else if (a === 'done') put('/done ' + id + ' ');
      else if (a === 'update') put('/update ' + id + ' ');
      else if (a === 'desc') put('/desc ' + id + ' ');
      else if (a === 'due') put('/due ' + id + ' ');
      else if (a === 'reassign') pickPeopleFor('reassign', '/reassign ' + id + ' ');
    }, SHEET_GAP);
  };
  // "/" sheet or a chip: insert the command, chain into the task list or the people picker
  const pickCommand = (c: Command) => {
    setSheet(null);
    refs.current = [];
    setTimeout(() => {
      // /task: one or more people (me too) -> "/task @A @B " with structured mentions for all
      if (c.cmd === '/task') openPeopleMany('Task kisko dena hai? (ek ya zyada)', (ps) => put(withMentions('/task ', ps)));
      // Round 4: /done and /re list my open tasks (needsTask); /re then chains into startReassign
      else if (c.needsTask) put(c.cmd + ' #');
      else if (c.cmd === '/tasks') openPeople('Kiske tasks?', (p) => put(withMention('/tasks ', p)), true);
      else put(c.cmd + (c.args ? ' ' : ''));
    }, SHEET_GAP);
  };

  // Round 4: old speech-to-text mic removed from the UI (useVoiceInput / VoiceBar files stay). The check-in card mic is hidden.
  const cardMic = undefined;

  // ---- media sending (photos, voice notes). Not via the outbox: upload, then POST ----
  const afterMedia = (message?: Msg) => {
    if (!message) return;
    if (message.clientId) sentHere.current.add(message.clientId);
    setMsgs((cur) => merge(cur, [message]));
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };
  const sendPhotos = async (items: PreviewItem[]) => {
    setPreviewUris(null);
    setUploading((n) => n + items.length);
    for (const it of items) {
      try { afterMedia((await sendImageToChat(chat.id, it.uri, it.caption)).message); }
      catch (e: any) { Alert.alert('Photo nahi gayi', e?.message || 'Dobara try karo'); }
      setUploading((n) => n - 1);
    }
  };
  const sendVoice = async (r: VoiceResult) => {
    const commandMode = /^\/(task|re|reassign|done)\b/i.test(text.trim());
    // typed "/task @Anubhav" goes along as the caption; the server joins it with the transcript ("<typed> <spoken>")
    const typed = commandMode ? text.trim() : '';
    const typedIds = typed ? mentionIdsFor(typed, refs.current) : [];
    const reply = replyTo && replyTo.id ? replyTo.id : undefined;
    setReplyTo(null);
    setUploading((n) => n + 1);
    try {
      const { url } = await uploadMedia(r.uri, 'audio', 'audio/mp4');
      const res = await api<{ message: Msg }>('POST', '/chats/' + chat.id + '/messages', {
        type: 'audio', mediaUrl: url, clientId: newClientId(), replyToId: reply,
        ...(typed ? { text: typed, mentionIds: typedIds } : {}),
        media: { kind: 'audio', durationMs: r.durationMs, waveform: r.waveform },
      });
      afterMedia(res.message);
      if (commandMode) { setText(''); refs.current = []; } // the server runs the spoken command from the transcript
    } catch (e: any) { Alert.alert('Voice note nahi gaya', e?.message || 'Dobara try karo'); }
    setUploading((n) => n - 1);
  };

  const onChange = (v: string) => {
    // Round 4: typing "/task " opens the person picker by itself
    if (ps.commandsEnabled && !editing && /^\/task $/i.test(v) && text.toLowerCase() === '/task') {
      const c = COMMANDS.find((x) => x.cmd === '/task');
      if (c) { setText(v); pickCommand(c); return; }
    }
    textRef.current = v;
    setText(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 2000) { lastTypingSent.current = now; sendTyping(chat.id); }
  };

  // ---- long-press menu ----
  const longPress = useCallback((m: Msg) => {
    if (m.deleted || m.type === 'system') return;
    if (m.failed && !m.id) { // outbox: server rejected it
      Alert.alert('Message nahi gaya', 'Dobara bhejein ya delete karein?', [
        { text: 'Retry', onPress: () => { setMsgs((cur) => cur.map((x) => (x.clientId === m.clientId ? { ...x, failed: false, pending: true } : x))); retryOutbox(m.clientId); } },
        { text: 'Delete', style: 'destructive', onPress: () => { removeFromOutbox(m.clientId); setMsgs((cur) => cur.filter((x) => x.clientId !== m.clientId)); } },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    setMenu(m);
  }, []);

  const doDelete = async (m: Msg) => {
    if (!m.id) {
      await removeFromOutbox(m.clientId);
      setMsgs((cur) => cur.filter((x) => x.clientId !== m.clientId));
      return;
    }
    try {
      await api('DELETE', '/messages/' + m.id);
      markDeleted(m.id);
    } catch (e: any) { Alert.alert('Could not delete', e.message); }
  };

  const react = useCallback(async (m: Msg, emoji: string) => {
    if (!m.id) return;
    try {
      const r = await api<{ reactions: Reaction[] }>('POST', '/messages/' + m.id + '/reactions', { emoji });
      setReactions(m.id, r.reactions);
    } catch (e: any) { toast(e.message); }
  }, [setReactions]);

  const startReply = useCallback((m: Msg) => {
    if (!m.id || m.deleted) return;
    setReplyTo(m);
    inputRef.current?.focus();
  }, []);

  const togglePin = async (m: Msg) => {
    try { await api('POST', '/chats/' + chat.id + '/pin', { messageId: pinned && pinned.id === m.id ? null : m.id }); }
    catch (e: any) { Alert.alert('Could not pin', e.message); }
  };

  const messagePrivately = async (m: Msg) => {
    try { onOpenChat((await api<{ chat: Chat }>('POST', '/chats/dm', { userId: m.senderId })).chat); }
    catch (e: any) { Alert.alert('Error', e.message); }
  };
  // Round 4: Reply privately = open / create the DM with the sender, quote the message (payload.quote on the next message)
  const replyPrivately = async (m: Msg) => {
    try {
      const dm = (await api<{ chat: Chat }>('POST', '/chats/dm', { userId: m.senderId })).chat;
      setPendingQuote(dm.id, { chatId: chat.id, messageId: m.id!, senderName: m.senderName + ' · ' + chat.name, text: previewOf(m).slice(0, 200) });
      onOpenChat(dm);
    } catch (e: any) { Alert.alert('Error', e.message); }
  };
  const startForward = async (m: Msg) => {
    setFwdMsg(m);
    try { setFwdChats((await api<{ chats: Chat[] }>('GET', '/chats')).chats); } catch (e) {}
  };
  const doForward = async (m: Msg, target: Chat) => {
    setFwdMsg(null);
    const isMedia = (m.type === 'image' || m.type === 'audio') && !!m.mediaUrl;
    const body = FWD + plainText(m);
    try {
      await api('POST', '/chats/' + target.id + '/messages', {
        type: isMedia ? m.type : 'text', text: body, mediaUrl: isMedia ? m.mediaUrl : undefined, media: isMedia ? m.media : undefined, clientId: newClientId(),
      });
      toast('Forward ho gaya: ' + target.name);
    } catch (e: any) { Alert.alert('Forward nahi hua', e.message); }
  };
  const doStar = (m: Msg) => {
    if (!m.id) return;
    const on = toggleStar({ chatId: chat.id, messageId: m.id, preview: previewOf(m).slice(0, 140), senderName: m.senderName, chatName: chat.name });
    toast(on ? 'Starred' : 'Unstarred');
  };
  const toggleMute = async () => {
    const next = !mutedL;
    setMutedL(next);
    try { await api('PATCH', '/chats/' + chat.id + '/me', { muted: next }); } catch (e: any) { setMutedL(!next); Alert.alert('Error', e.message); }
  };

  const menuAction = (fn: () => void) => { setMenu(null); setTimeout(fn, 50); };
  const renderMenu = () => {
    const m = menu;
    if (!m) return null;
    const isBot = m.type === 'bot' || m.type === 'checkin_prompt';
    const canEdit = canEditMsg(m, me.id);
    // own text within 10 min (everyone, admin too), an unsent message, or my own "only visible to you" card
    const canDelete = canEdit || canDeleteMedia(m, me.id) || !m.id || (m.type === 'bot' && m.visibleTo === me.id);
    const aiAnswer = m.type === 'bot' && (m.payload as any)?.kind === 'ai_answer';
    const mineReact = (e: string) => !!m.reactions?.find((r) => r.emoji === e)?.userIds.includes(me.id);
    return (
      <>
        {!!m.id && !isBot && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 8 }}>
            {EMOJIS.map((e) => (
              <Pressable
                key={e} onPress={() => menuAction(() => react(m, e))}
                style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: mineReact(e) ? t.chip : t.soft }}
              >
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!m.id && (!isBot || isTaskCard(m)) && <SheetRow icon="arrow-undo-outline" label="Reply" onPress={() => menuAction(() => startReply(m))} />}
        {!!m.id && m.senderId !== me.id && !isBot && !m.deleted && (chat.type === 'group' || chat.type === 'all') && (
          <SheetRow icon="return-up-forward-outline" label="Reply privately" onPress={() => menuAction(() => replyPrivately(m))} />
        )}
        {(!isBot || aiAnswer) && !!plainText(m) && <SheetRow icon="copy-outline" label="Copy" onPress={() => menuAction(() => copyText(plainText(m)))} />}
        {!!m.id && (!isBot || aiAnswer) && !m.deleted && m.visibleTo == null && (
          <SheetRow icon="arrow-redo-outline" label="Forward" onPress={() => menuAction(() => startForward(m))} />
        )}
        {!!m.id && !m.deleted && m.visibleTo == null && (
          <SheetRow icon={starIds.has(m.id) ? 'star' : 'star-outline'} label={starIds.has(m.id) ? 'Unstar' : 'Star'} onPress={() => menuAction(() => doStar(m))} />
        )}
        {!!m.id && m.senderId === me.id && !isBot && !m.deleted && (
          <SheetRow icon="information-circle-outline" label="Info" onPress={() => menuAction(() => setInfoMsg(m))} />
        )}
        {canEdit && <SheetRow icon="pencil-outline" label="Edit" onPress={() => menuAction(() => startEdit(m))} />}
        {!!m.id && m.visibleTo == null && (
          <SheetRow icon="pin-outline" label={pinned && pinned.id === m.id ? 'Unpin' : 'Pin'} onPress={() => menuAction(() => togglePin(m))} />
        )}
        {/* Round 4: replaced by "Reply privately" above (messagePrivately kept for reference)
        {!!m.id && m.senderId !== me.id && !isBot && (chat.type === 'group' || chat.type === 'all') && (
          <SheetRow icon="chatbubble-outline" label={'Message ' + m.senderName.split(' ')[0] + ' privately'} onPress={() => menuAction(() => messagePrivately(m))} />
        )} */}
        {!isBot && m.type !== 'image' && m.type !== 'audio' && ps.commandsEnabled && chat.type !== 'checkin' && me.role === 'boss' && (
          <SheetRow
            icon="checkbox-outline" label="Make task"
            onPress={() => menuAction(() => {
              refs.current = [];
              put(m.senderId !== me.id ? withMention('/task ', { id: m.senderId, name: m.senderName }) : '/task ');
            })}
          />
        )}
        {canDelete && <SheetRow icon="trash-outline" label="Delete" danger onPress={() => menuAction(() => doDelete(m))} />}
      </>
    );
  };

  // ---- list items ----
  // human messages seen in this screen (any filter): AI-mode quotes of a card's source
  const seenSrc = useRef(new Map<number, string>());
  // previous attachment arrays, reused while their cards are unchanged (keeps Bubble memo working)
  const attCache = useRef(new Map<number, Msg[]>());
  // a reply to a photo / voice note: the server sends an empty quote text, show "📷 Photo" (cached per message object)
  const replyFix = useRef(new WeakMap<Msg, Msg>());
  const items = useMemo(() => {
    const asc: Item[] = [];
    let prev = '';
    let unreadShown = unreadFrom.current === null;
    const from = unreadFrom.current ?? 0;
    const unreadCount = unreadFrom.current === null ? 0
      : msgs.filter((m) => m.id && m.id > from && m.senderId !== me.id && m.type !== 'system').length;
    const byId = new Map<number, Msg>();
    for (const m of msgs) if (m.id) byId.set(m.id, m);
    for (const m of msgs) if (m.id && isHuman(m) && !m.deleted && m.text) seenSrc.current.set(m.id, m.text);
    // All: a card whose source message is loaded (and not deleted) is drawn under that bubble, not as its own row
    const att = new Map<number, Msg[]>();
    if (kind === 'all') {
      for (const m of msgs) {
        if (m.type !== 'bot' || !m.sourceMessageId) continue;
        const src = byId.get(m.sourceMessageId);
        if (!src || src.deleted || !isHuman(src)) continue;
        const list = att.get(src.id!) || [];
        list.push(m);
        att.set(src.id!, list);
      }
      for (const [id, list] of att) {
        const old = attCache.current.get(id);
        if (old && old.length === list.length && old.every((x, i) => x === list[i])) att.set(id, old);
      }
      attCache.current = att;
    }
    const attached = new Set<Msg>();
    for (const list of att.values()) for (const c of list) attached.add(c);
    for (const m of msgs) {
      if (attached.has(m)) continue;
      if (kind === 'chat' && !isHuman(m)) continue;
      if (kind === 'ai' && m.type !== 'bot' && !m.pending && !(m.clientId && sentHere.current.has(m.clientId))) continue;
      const day = new Date(m.createdAt).toDateString();
      if (day !== prev) { asc.push({ kind: 'date', key: 'd' + day + '#' + asc.length, label: dayLabel(m.createdAt) }); prev = day; }
      if (!unreadShown && m.id && m.id > from && m.senderId !== me.id && m.type !== 'system') {
        unreadShown = true;
        asc.push({ kind: 'unread', key: 'unread', count: unreadCount });
      }
      const quote = kind === 'ai' && m.type === 'bot' && m.sourceMessageId ? seenSrc.current.get(m.sourceMessageId) || null : null;
      let shown = m;
      const rtq = m.replyTo;
      if (rtq && !rtq.deleted && !rtq.text) {
        const lab = mediaLabel(byId.get(rtq.id) || ({} as Msg));
        if (lab) {
          let f = replyFix.current.get(m);
          if (!f) { f = { ...m, replyTo: { ...rtq, text: lab } }; replyFix.current.set(m, f); }
          shown = f;
        }
      }
      asc.push({ kind: 'msg', key: m.clientId || String(m.id), msg: shown, attachments: m.id ? att.get(m.id) : undefined, quote });
    }
    return asc.reverse();
  }, [msgs, me.id, kind]);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // tap on a quote / the pinned bar: scroll to the original if it is loaded
  const jumpTo = useCallback((id: number) => {
    const idx = itemsRef.current.findIndex((i) => i.kind === 'msg' && (i.msg.id === id || !!i.attachments?.some((a) => a.id === id)));
    if (idx < 0) { toast('Original message is not loaded'); return; }
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }, []);

  // opened for one message (ask banner, notification, timeline): scroll there once it is in the list
  const focusDone = useRef(!focusId);
  useEffect(() => {
    if (focusDone.current || !loaded || !focusId) return;
    const found = items.some((i) => i.kind === 'msg' && (i.msg.id === focusId || !!i.attachments?.some((a) => a.id === focusId)));
    if (!found) return;
    focusDone.current = true;
    setTimeout(() => jumpTo(focusId), 400);
  }, [loaded, items, focusId, jumpTo]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const away = e.nativeEvent.contentOffset.y > 120; // inverted list: 0 = newest
    atBottom.current = !away;
    setShowJump((v) => (v === away ? v : away));
    if (!away) setBelowCount((n) => (n ? 0 : n));
  };
  const jumpBottom = () => { listRef.current?.scrollToOffset({ offset: 0, animated: true }); setBelowCount(0); };

  const tickOf = (m: Msg): TickStatus => {
    if (!m.id) return m.failed ? 'failed' : 'pending';
    if (m.id <= status.read) return 'read';
    if (m.id <= status.delivered) return 'delivered';
    return 'sent';
  };

  // ---- composer suggestions: @mentions, slash palette, my tasks after "/done #" ----
  const taskCmd = /^\/(\w+)\s+#(\S*)$/.exec(text);
  const needsTasks = !!taskCmd && ps.commandsEnabled && COMMANDS.some((c) => c.cmd === '/' + (taskCmd[1] === 'reassign' ? 're' : taskCmd[1]) && c.needsTask);
  const isAsk = !!taskCmd && taskCmd[1] === 'ask';
  // plain text ending in "#12" / "#": my tasks (a message with one "#N" becomes a task note on the server)
  const hashQ = !taskCmd && !/^\//.test(text) ? /(^|\s)#(\d*)$/.exec(text) : null;
  const wantTasks = needsTasks || (!!hashQ && ps.commandsEnabled);
  const isBoss = me.role === 'boss';
  useEffect(() => {
    if (!wantTasks) return;
    if (isAsk) {
      // /ask is about someone else's task: every open task that is not mine
      api<{ tasks: AnyTask[] }>('GET', '/tasks?scope=' + (isBoss ? 'all' : 'everyone'))
        .then((r) => setAskTasks(r.tasks.filter((x) => isOpen(x.status) && !idsOfAny(x).includes(me.id)))).catch(() => {});
      return;
    }
    api<{ tasks: AnyTask[] }>('GET', '/tasks?scope=' + (isBoss ? 'all' : 'mine'))
      .then((r) => setMyTasks(r.tasks.filter((x) => isOpen(x.status)))).catch(() => {});
  }, [wantTasks, isAsk, me.id, isBoss]);
  const statusTag = (s: string) => (
    <View style={{ backgroundColor: colorOf(s), borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 }}>
      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{labelOf(s)}</Text>
    </View>
  );
  const taskSub = (x: AnyTask) => {
    const who = assigneeNamesOf(x).join(', ');
    return 'Task ' + x.id + (who ? '  ·  ' + who : '') + (!isBrief(x) && x.project ? '  ·  ' + x.project : '');
  };
  const matchTask = (x: AnyTask, q: string) =>
    !q || String(x.id).startsWith(q) || x.title.toLowerCase().includes(q) || assigneeNamesOf(x).some((n) => n.toLowerCase().includes(q));

  const suggestions: Suggestion[] = (() => {
    if (needsTasks && taskCmd) {
      const q = taskCmd[2].toLowerCase();
      return ((isAsk ? askTasks : myTasks) ?? [])
        .filter((x) => matchTask(x, q))
        .slice(0, 8)
        .map((x) => ({
          key: 't' + x.id, title: 'Task ' + x.id + ' · ' + x.title, sub: taskSub(x),
          left: <Ionicons name="checkbox-outline" size={20} color={colorOf(x.status)} />,
          right: statusTag(x.status),
          onPress: () => {
            const cmd = taskCmd[1].toLowerCase();
            const base = '/' + taskCmd[1] + ' #' + x.id + ' ';
            if (cmd === 're' || cmd === 'reassign') startReassign(x);
            else if (PEOPLE_CMD[cmd]) pickPeopleFor(cmd, base);
            else put(base);
          },
        }));
    }
    if (hashQ && ps.commandsEnabled) {
      const q = hashQ[2];
      return (myTasks ?? []).filter((x) => matchTask(x, q)).slice(0, 6).map((x) => ({
        key: 'h' + x.id, title: 'Task ' + x.id + ' · ' + x.title, sub: taskSub(x),
        left: <Ionicons name="checkbox-outline" size={20} color={colorOf(x.status)} />,
        right: statusTag(x.status),
        onPress: () => put(text.slice(0, text.length - q.length) + x.id + ' '),
      }));
    }
    if (ps.commandsEnabled && /^\/due\s+#\d+\s+$/.test(text)) {
      return DUE_CHIPS.map((d) => ({
        key: 'due' + d, title: d, sub: d === 'none' ? 'Due date hatao' : undefined,
        left: <Ionicons name="calendar-outline" size={20} color={t.accent} />,
        onPress: () => put(text + d),
      }));
    }
    if (ps.commandsEnabled && /^\/\S*$/.test(text)) {
      const q = text.toLowerCase();
      return COMMANDS.filter((c) => c.cmd.startsWith(q)).map((c) => ({
        key: c.cmd, title: c.cmd + (c.args ? '  ' + c.args : ''), sub: c.desc,
        left: <Text style={{ color: t.accent, fontSize: 18, fontWeight: '700', width: 20, textAlign: 'center' }}>/</Text>,
        onPress: () => pickCommand(c), // Round 4: /task opens the person picker, /done and /re list my tasks
      }));
    }
    const mm = /(^|\s)@([\p{L}\p{N}_]*)$/u.exec(text);
    if (mm && members.length) {
      const q = mm[2].toLowerCase();
      // me only right after /task /assign /unassign /reassign (task for myself)
      const withMe = TASK_CMD_ME.test(text);
      const meRow = withMe && (!q || 'me khud'.includes(q) || me.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
        ? [{ id: me.id, name: me.name, role: me.role, isCreator: false, phone: me.phone } as Member] : [];
      return [...meRow, ...members
        .filter((m) => m.id !== me.id && (!q || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))))]
        .slice(0, 6)
        .map((m) => ({
          key: 'm' + m.id, title: m.id === me.id ? 'Me (khud)' : m.name,
          sub: [m.role === 'boss' ? 'Admin' : '', phoneTail(m.phone)].filter(Boolean).join('  ·  ') || undefined,
          left: <Avatar name={m.name} id={m.id} userId={m.id} size={32} />,
          onPress: () => {
            refs.current = [...refs.current, { id: m.id, label: '@' + firstName(m.name) }];
            setText(text.slice(0, text.length - mm[2].length) + firstName(m.name) + ' ');
          },
        }));
    }
    return [];
  })();

  const subtitle = typingName
    ? (chat.type === 'dm' ? 'typing...' : typingName + ' is typing...')
    : chat.type === 'checkin' ? 'Aapke reports admin dekh sakte hain'
    : chat.type === 'dm' ? '' : (members.length || chat.membersCount) + ' members';
  // info page for group / all / dm (ChatsScreen routes onOpenInfo for every type)
  const hasInfo = chat.type !== 'checkin';
  // check-in chat too: "/" and the task button (typed check-in text logic is unchanged)
  const helpers = ps.commandsEnabled;
  // Round 4: composer helpers live in the chip row (the row itself is the WhatsApp pill)
  const showChips = helpers && !editing && !text && !suggestions.length;
  const quick = QUICK.map((q) => COMMANDS.find((c) => c.cmd === q)!).filter(Boolean);
  const chipBtn = (label: string, onPress: () => void, icon?: keyof typeof Ionicons.glyphMap, key?: string) => (
    <Pressable
      key={key || label} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: t.card, marginRight: 6, borderWidth: 1, borderColor: t.border }}
    >
      {!!icon && <Ionicons name={icon} size={15} color={t.accent} />}
      <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', marginLeft: icon ? 5 : 0 }}>{label}</Text>
    </Pressable>
  );
  // second helper chip: DM = tasks with this person, check-in = new task (for me), else "@" person actions
  const personChip = () =>
    chat.type === 'dm' && chat.otherUserId ? chipBtn('Tasks', () => setSheet('dmTasks'), 'clipboard-outline')
      : chat.type === 'checkin' ? chipBtn('Naya task', () => setSheet('newTask'), 'add-circle-outline')
      : chipBtn('person', openPersonActions, 'at');
  // /task: day + time chips (text like "kal 5 pm" is appended; the server AI parses it)
  const isTaskText = helpers && !editing && /^\/task\b/i.test(text) && refs.current.length > 0 && text.trim().split(/\s+/).length > 2;
  const hasDay = /\b(aaj|kal|parso|today|tomorrow)\b/i.test(text);
  const hasTime = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(text);
  const taskChips = isTaskText ? (!hasDay ? ['Aaj', 'Kal', 'Parso'] : !hasTime ? ['9 am', '12 pm', '5 pm', '8 pm'] : []) : [];
  const appendChip = (c: string) => setText(text.replace(/\s+$/, '') + ' ' + (/^\d/.test(c) ? c : c.toLowerCase()));
  const voiceHint = helpers && /^\/(task|re|reassign)\b/i.test(text.trim()) ? (/^\/task/i.test(text.trim()) ? 'Bolo: kis ko, kya task' : 'Bolo: kaun sa task, kis ko')
    : helpers && /^\/done\b/i.test(text.trim()) ? 'Bolo: kaun sa task done' : null;

  // search in chat: loaded messages whose text / caption / address / transcript contain the query
  const sq = searchQ.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!searchOpen || !sq) return [] as number[];
    return msgs.filter((m) => m.id && !m.deleted && m.type !== 'system'
      && ((m.text || '').toLowerCase().includes(sq) || (m.media?.transcript || '').toLowerCase().includes(sq) || (m.media?.address || '').toLowerCase().includes(sq)))
      .map((m) => m.id as number);
  }, [msgs, sq, searchOpen]);
  const curMatch = matchIds.length ? matchIds[matchIds.length - 1 - Math.min(searchPos, matchIds.length - 1)] : null;
  useEffect(() => { if (curMatch) jumpTo(curMatch); }, [curMatch]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeSearch = () => { setSearchOpen(false); setSearchQ(''); setSearchPos(0); };

  const renderItem = useCallback(({ item }: { item: Item }) =>
    item.kind === 'date' ? (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ backgroundColor: t.card, color: t.subtext, fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' }}>
          {item.label}
        </Text>
      </View>
    ) : item.kind === 'unread' ? (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ backgroundColor: t.chip, color: t.text, fontSize: 12, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' }}>
          {item.count} unread message{item.count === 1 ? '' : 's'}
        </Text>
      </View>
    ) : (
      <Bubble
        msg={item.msg}
        mine={item.msg.senderId === me.id}
        showSender={chat.type === 'group' || chat.type === 'all'}
        status={tickOf(item.msg)}
        t={t}
        onLongPress={longPress}
        onReply={startReply}
        onQuotePress={jumpTo}
        onReact={react}
        onOpenTask={openTask}
        onSendText={onSendText}
        onPrefill={put}
        onCardMic={cardMic}
        meId={me.id}
        meName={me.name}
        isBoss={me.role === 'boss'}
        highlight={!!item.msg.id && (item.msg.id === flashId || item.msg.id === curMatch)}
        onOpenImage={openImage}
        starred={!!item.msg.id && starIds.has(item.msg.id)}
        attachments={item.attachments}
        quote={item.quote}
        onTaskChip={onTaskChip}
      />
    ), [t, me.id, me.name, me.role, chat.type, status, flashId, curMatch, starIds, longPress, startReply, jumpTo, react, openTask, onSendText, put, cardMic, onTaskChip]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Pressable onPress={() => hasInfo && onOpenInfo(chat)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {chat.type === 'dm' && chat.otherUserId
            ? <Avatar name={chat.name} id={chat.otherUserId} userId={chat.otherUserId} emoji={chat.otherUserEmoji} size={38} />
            : <Avatar name={chat.name} id={chat.id} size={38} />}
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{chat.name}</Text>
            {!!subtitle && <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{subtitle}</Text>}
          </View>
        </Pressable>
        <Pressable onPress={() => setHeadMenu(true)} hitSlop={8} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Menu">
          <Ionicons name="ellipsis-vertical" size={22} color={t.onAccent} />
        </Pressable>
      </View>
      {searchOpen && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 8, minHeight: 48, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Pressable onPress={closeSearch} hitSlop={8} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={22} color={t.subtext} />
          </Pressable>
          <TextInput
            value={searchQ} onChangeText={(v) => { setSearchQ(v); setSearchPos(0); }} autoFocus placeholder="Search in chat" placeholderTextColor={t.subtext}
            style={{ flex: 1, color: t.text, fontSize: 16, paddingVertical: 8 }}
          />
          {!!sq && <Text style={{ color: t.subtext, fontSize: 13, marginHorizontal: 6 }}>{matchIds.length ? Math.min(searchPos, matchIds.length - 1) + 1 + '/' + matchIds.length : '0'}</Text>}
          <Pressable onPress={() => setSearchPos((p) => Math.min(p + 1, Math.max(0, matchIds.length - 1)))} hitSlop={6} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="chevron-up" size={22} color={t.subtext} />
          </Pressable>
          <Pressable onPress={() => setSearchPos((p) => Math.max(0, p - 1))} hitSlop={6} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="chevron-down" size={22} color={t.subtext} />
          </Pressable>
        </View>
      )}
      {filterable && (
        <View style={{ flexDirection: 'row', backgroundColor: t.card, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.soft, borderRadius: 16, padding: 2 }}>
            {(['ai', 'all', 'chat'] as Kind[]).map((k) => (
              <Pressable
                key={k} onPress={() => changeKind(k)}
                style={{ flex: 1, minHeight: 30, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === k ? t.accent : 'transparent' }}
              >
                <Text style={{ color: kind === k ? '#fff' : t.text, fontSize: 13, fontWeight: '600' }}>{k === 'ai' ? 'AI' : k === 'all' ? 'All' : 'Chat'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      {!!pinned && (
        <Pressable
          onPress={() => jumpTo(pinned.id)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 14, minHeight: 44, borderBottomWidth: 1, borderBottomColor: t.border }}
        >
          <Ionicons name="pin" size={16} color={t.accent} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text numberOfLines={1} style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>Pinned · {pinned.senderName}</Text>
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13 }}>{pinned.body}</Text>
          </View>
        </Pressable>
      )}
      <View style={{ flex: 1, backgroundColor: t.wallpaper }}>
        <FlatList
          ref={listRef}
          inverted
          data={items}
          keyExtractor={(i) => i.key}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={64}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={11}
          contentContainerStyle={{ paddingVertical: 8 }}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 300);
          }}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={t.accent} style={{ padding: 12 }} /> : null}
          ListEmptyComponent={
            <View style={{ padding: 30, alignItems: 'center' }}>
              {loaded ? <Text style={{ color: t.subtext }}>No messages yet. Say hi!</Text> : <ActivityIndicator color={t.accent} />}
            </View>
          }
          renderItem={renderItem}
        />
        {showJump && (
          <Pressable
            onPress={jumpBottom}
            style={{ position: 'absolute', right: 14, bottom: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
          >
            <Ionicons name="chevron-down" size={24} color={t.subtext} />
            {belowCount > 0 && (
              <View style={{ position: 'absolute', top: -6, right: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{belowCount > 99 ? '99+' : belowCount}</Text>
              </View>
            )}
          </Pressable>
        )}
      </View>
      {!!replyTo && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 10, paddingTop: 8 }}>
          <View style={{ flex: 1, borderLeftWidth: 4, borderLeftColor: t.accent, backgroundColor: t.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text numberOfLines={1} style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>
              {replyTo.senderId === me.id ? 'You' : replyTo.senderName}
            </Text>
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13 }}>{previewOf(replyTo)}</Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={10} style={{ padding: 8 }}>
            <Ionicons name="close" size={22} color={t.subtext} />
          </Pressable>
        </View>
      )}
      {!!quote && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 10, paddingTop: 8 }}>
          <Ionicons name="return-up-forward-outline" size={18} color={t.accent} style={{ marginHorizontal: 6 }} />
          <View style={{ flex: 1, borderLeftWidth: 4, borderLeftColor: t.accent, backgroundColor: t.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text numberOfLines={1} style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>{quote.senderName}</Text>
            <Text numberOfLines={2} style={{ color: t.subtext, fontSize: 13 }}>{quote.text}</Text>
          </View>
          <Pressable onPress={() => setQuote(null)} hitSlop={10} style={{ padding: 8 }}>
            <Ionicons name="close" size={22} color={t.subtext} />
          </Pressable>
        </View>
      )}
      {uploading > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 14, paddingTop: 8 }}>
          <ActivityIndicator size="small" color={t.accent} />
          <Text style={{ color: t.subtext, fontSize: 13, marginLeft: 10 }}>Bhej rahe hain… ({uploading})</Text>
        </View>
      )}
      {!!editing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, paddingHorizontal: 10, paddingTop: 8 }}>
          <Ionicons name="pencil" size={18} color={t.accent} style={{ marginHorizontal: 6 }} />
          <View style={{ flex: 1, borderLeftWidth: 4, borderLeftColor: t.accent, backgroundColor: t.background, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>Message edit karein</Text>
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13 }}>{editing.text || ''}</Text>
          </View>
          <Pressable onPress={cancelEdit} hitSlop={10} style={{ padding: 8 }}>
            <Ionicons name="close" size={22} color={t.subtext} />
          </Pressable>
        </View>
      )}
      <Suggestions items={suggestions} t={t} />
      {(showChips || taskChips.length > 0) && (
        <ScrollView
          horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 2, alignItems: 'center' }}
        >
          {taskChips.length > 0
            ? taskChips.map((c) => chipBtn(c, () => appendChip(c), 'calendar-outline', 'tc' + c))
            : (
              <>
                {chipBtn('/', () => setSheet('cmd'), undefined, 'slash')}
                {quick.map((c) => chipBtn(c.cmd, () => pickCommand(c), c.icon, c.cmd))}
                {personChip()}
              </>
            )}
        </ScrollView>
      )}
      <Composer
        t={t} text={text} onChangeText={onChange} inputRef={inputRef} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        editing={!!editing} canSend={!!text.trim()} onSend={() => send(textRef.current)}
        onAttach={() => setAttachOpen(true)} onGeo={() => setGeoOpen(true)} onVoice={sendVoice} onNotice={toast}
        voiceHint={voiceHint} bottom={insets.bottom}
      />
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.senderName}>{renderMenu()}</Sheet>
      <CommandSheet visible={sheet === 'cmd'} onClose={() => setSheet(null)} onPick={pickCommand} />
      <PeopleSheet
        visible={sheet === 'people'} onClose={() => { peoplePick.current = null; peoplePickMany.current = null; setSheet(null); }} title={peopleTitle}
        people={peopleSrc ?? pickList} loading={!storeUsers.length} onPick={pickedPerson}
        me={peopleOpts.includeMe ? mePerson : null} multi={peopleOpts.multi} onPickMany={pickedPeople}
      />
      <PersonSheet visible={sheet === 'person'} onClose={() => setSheet(null)} person={person} tasks={personTasks} onAction={personAction} />
      {chat.type === 'dm' && !!chat.otherUserId && sheet === 'dmTasks' && (
        <DmTasksSheet
          visible onClose={() => setSheet(null)} otherUserId={chat.otherUserId} name={chat.name} chatId={chat.id}
          onOpenTask={(id) => { setSheet(null); openTask(id); }}
        />
      )}
      {sheet === 'newTask' && (
        <TaskModal visible meId={me.id} initialAssigneeIds={[me.id]} onClose={() => setSheet(null)} onDone={() => setSheet(null)} />
      )}
      {chipTask !== null && (
        <TaskActionSheet visible taskId={chipTask} onClose={() => setChipTask(null)} onOpen={(id) => { setChipTask(null); openTask(id); }} />
      )}
      <InAppBanner />
      <Sheet visible={headMenu} onClose={() => setHeadMenu(false)} title={chat.name}>
        <SheetRow icon="search-outline" label="Search in chat" onPress={() => { setHeadMenu(false); setTimeout(() => setSearchOpen(true), 50); }} />
        <SheetRow icon="images-outline" label="Media" onPress={() => { setHeadMenu(false); setTimeout(() => setMediaOpen(true), SHEET_GAP); }} />
        <SheetRow icon={mutedL ? 'notifications-outline' : 'notifications-off-outline'} label={mutedL ? 'Unmute' : 'Mute'} onPress={() => { setHeadMenu(false); toggleMute(); }} />
        {hasInfo && <SheetRow icon="information-circle-outline" label={chat.type === 'dm' ? 'Chat info' : 'Group info'} onPress={() => { setHeadMenu(false); setTimeout(() => onOpenInfo(chat), 50); }} />}
      </Sheet>
      <MediaGridModal visible={mediaOpen} onClose={() => setMediaOpen(false)} msgs={msgs} />
      <AttachSheet visible={attachOpen} onClose={() => setAttachOpen(false)} onPicked={setPreviewUris} onGeo={() => setGeoOpen(true)} />
      <Modal visible={!!previewUris} animationType="slide" onRequestClose={() => setPreviewUris(null)} statusBarTranslucent>
        {!!previewUris && <PhotoPreviewPanel uris={previewUris} onSend={sendPhotos} onCancel={() => setPreviewUris(null)} />}
      </Modal>
      <GeoCameraScreen visible={geoOpen} chatId={chat.id} onClose={() => setGeoOpen(false)} onSent={afterMedia} />
      <ImageViewer
        visible={!!viewMsg} url={viewMsg?.mediaUrl || null} caption={viewMsg ? plainText(viewMsg) : null} title={viewMsg?.senderName}
        onClose={() => setViewMsg(null)}
      />
      <SendToSheet
        visible={!!fwdMsg} onClose={() => setFwdMsg(null)} chats={fwdChats} title="Forward to..."
        onPick={(c) => fwdMsg && doForward(fwdMsg, c)}
      />
      <Sheet visible={!!infoMsg} onClose={() => setInfoMsg(null)} title="Message info">
        {!!infoMsg && (
          <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
            <Text style={{ color: t.text, fontSize: 15 }}>Sent: {new Date(infoMsg.createdAt).toLocaleString()}</Text>
            <Text style={{ color: t.text, fontSize: 15, marginTop: 8 }}>
              {{ pending: 'Bhej rahe hain', failed: 'Nahi gaya (tap karke retry)', sent: 'Sent', delivered: 'Delivered (sabko)', read: 'Read (sabne dekha)' }[tickOf(infoMsg)]}
            </Text>
            <Text style={{ color: t.subtext, fontSize: 12, marginTop: 8 }}>Har member ka alag read time abhi available nahi.</Text>
          </View>
        )}
      </Sheet>
    </KeyboardAvoidingView>
  );
}
