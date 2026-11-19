import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform, AppState, ActivityIndicator, ScrollView,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat, Msg, ReplyRef, Reaction } from '../chatTypes';
import { AnyTask, assigneeIdsOf, assigneeNamesOf, colorOf, isBrief, isOpen, labelOf, Task } from '../taskTypes';
import { loadUsers as loadStoreUsers, useUsers } from '../userStore';
import { onEvent, sendTyping } from '../realtime';
import { enqueue, flushOutbox, newClientId, onSent, pendingFor, removeFromOutbox } from '../outbox';
import { COMMANDS, Command, DUE_CHIPS, QUICK } from '../commands';
import { CommandSheet, firstName, PeopleSheet, PersonAction, PersonSheet, phoneTail, PickPerson } from '../components/ComposerSheets';
import { usePublicSettings } from '../publicSettings';
import Avatar from '../components/Avatar';
import Bubble, { isTaskCard } from '../components/Bubble';
import Sheet, { SheetRow } from '../components/Sheet';
import Suggestions, { Suggestion } from '../components/Suggestions';
import { TickStatus } from '../components/Tick';
import VoiceBar, { MicButton } from '../components/VoiceBar';
import { copyText } from '../dates';
import TaskActionSheet from '../components/TaskActionSheet';
import TaskModal from '../components/TaskModal';
import DmTasksSheet from '../components/DmTasksSheet';
import InAppBanner from '../components/InAppBanner';
import { toast, useVoiceInput } from '../useVoiceInput';

type Item =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'msg'; key: string; msg: Msg; attachments?: Msg[]; quote?: string | null };
type Kind = 'all' | 'ai' | 'chat'; // group filter: AI = bot cards only, Chat = human text only
// one sheet closes, the next opens: wait for the closing Modal's fade (Android drops a Modal shown while another is dismissing)
const SHEET_GAP = 350;
const kindByChat = new Map<number, Kind>(); // filter remembered per chat (memory only)
const drafts = new Map<number, { text: string; refs: { id: number; label: string }[] }>(); // unsent composer text per chat
const isHuman = (m: Msg) => !m.type || m.type === 'text';
const TASK_CMD_ME = /^\/(task|assign|unassign|reassign)\b/i; // inline "@" offers me only after these
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
const canEditMsg = (m: Msg, meId: number) =>
  !!m.id && !m.deleted && m.senderId === meId && (!m.type || m.type === 'text') && m.visibleTo == null &&
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
    return () => { off(); offSent(); app.remove(); clearInterval(retry); if (typingTimer.current) clearTimeout(typingTimer.current); };
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

  const voice = useVoiceInput();

  const send = (raw = text, keepReply = false, ids?: number[]) => {
    const body = raw.trim();
    if (!body) return;
    if (editing && !keepReply) { saveEdit(body); return; }
    const mentionIds = ids ?? (keepReply ? [] : mentionIdsFor(body, refs.current));
    const clientId = newClientId();
    sentHere.current.add(clientId);
    const createdAt = new Date().toISOString();
    const rt = keepReply ? null : replyTo;
    const ref: ReplyRef | null = rt && rt.id
      ? { id: rt.id, senderName: rt.senderName, text: (rt.text || '').slice(0, 200), deleted: false }
      : null;
    setMsgs((cur) => merge(cur, [{
      clientId, chatId: chat.id, senderId: me.id, senderName: me.name, text: body, deleted: false, createdAt, pending: true,
      replyTo: ref,
    }]));
    if (!keepReply) { setText(''); setReplyTo(null); refs.current = []; }
    enqueue(chat.id, body, clientId, createdAt, ref, mentionIds);
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
  const openPeople = (title: string, onPick: (p: PickPerson) => void, includeMe = false) => {
    peoplePick.current = onPick;
    peoplePickMany.current = null;
    setPeopleTitle(title);
    setPeopleOpts({ includeMe, multi: false });
    if (!storeUsers.length) loadStoreUsers();
    setSheet('people');
  };
  const openPeopleMany = (title: string, onPick: (ps: PickPerson[]) => void, includeMe = true) => {
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
  const PEOPLE_CMD: Record<string, string> = { reassign: 'Kisko dena hai?', assign: 'Kisko jodna hai?', unassign: 'Kisko hatana hai?' };
  const pickPeopleFor = (cmd: string, base: string) =>
    openPeopleMany(PEOPLE_CMD[cmd] || 'Kaun?', (tos) => { refs.current = []; put(withMentions(base, tos)); });
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
      else if (c.needsTask) put(c.cmd + ' #');
      else if (c.cmd === '/tasks') openPeople('Kiske tasks?', (p) => put(withMention('/tasks ', p)), true);
      else put(c.cmd + (c.args ? ' ' : ''));
    }, SHEET_GAP);
  };

  // voice: stop -> transcript goes into the text box to edit; send -> sent at once; X -> discarded
  const cardTarget = useRef<((said: string) => void) | null>(null); // set while voice types into a check-in card
  const cardMic = useMemo(() => (voice.available ? (cb: (said: string) => void) => {
    cardTarget.current = cb;
    voice.start(toBoxRef.current);
  } : undefined), [voice.available]); // eslint-disable-line react-hooks/exhaustive-deps
  const toBoxRef = useRef<(said: string) => void>(() => {});
  const toBox = (said: string) => {
    const target = cardTarget.current;
    cardTarget.current = null;
    if (!said) { toast('Kuch sunai nahi diya'); return; }
    if (target) { target(said); return; }
    setText((cur) => (cur ? cur + ' ' + said : said));
  };
  toBoxRef.current = toBox;
  const voiceStop = async () => toBox(await voice.finish());
  const voiceSend = async () => {
    const said = await voice.finish();
    if (!said) { cardTarget.current = null; toast('Kuch sunai nahi diya'); return; }
    const target = cardTarget.current;
    cardTarget.current = null;
    if (target) target(said);
    else send(said);
  };

  const onChange = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 2000) { lastTypingSent.current = now; sendTyping(chat.id); }
  };

  // ---- long-press menu ----
  const longPress = useCallback((m: Msg) => {
    if (m.deleted || m.type === 'system') return;
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

  const menuAction = (fn: () => void) => { setMenu(null); setTimeout(fn, 50); };
  const renderMenu = () => {
    const m = menu;
    if (!m) return null;
    const isBot = m.type === 'bot' || m.type === 'checkin_prompt';
    const canEdit = canEditMsg(m, me.id);
    // own text within 10 min (everyone, admin too), an unsent message, or my own "only visible to you" card
    const canDelete = canEdit || !m.id || (m.type === 'bot' && m.visibleTo === me.id);
    const mineReact = (e: string) => !!m.reactions?.find((r) => r.emoji === e)?.userIds.includes(me.id);
    return (
      <>
        {!!m.id && !isBot && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 8 }}>
            {EMOJIS.map((e) => (
              <Pressable
                key={e} onPress={() => menuAction(() => react(m, e))}
                style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: mineReact(e) ? 'rgba(37,211,102,0.25)' : t.soft }}
              >
                <Text style={{ fontSize: 24 }}>{e}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!m.id && (!isBot || isTaskCard(m)) && <SheetRow icon="arrow-undo-outline" label="Reply" onPress={() => menuAction(() => startReply(m))} />}
        {!isBot && !!m.text && <SheetRow icon="copy-outline" label="Copy" onPress={() => menuAction(() => copyText(m.text || ''))} />}
        {canEdit && <SheetRow icon="pencil-outline" label="Edit" onPress={() => menuAction(() => startEdit(m))} />}
        {!!m.id && m.visibleTo == null && (
          <SheetRow icon="pin-outline" label={pinned && pinned.id === m.id ? 'Unpin' : 'Pin'} onPress={() => menuAction(() => togglePin(m))} />
        )}
        {!!m.id && m.senderId !== me.id && !isBot && (chat.type === 'group' || chat.type === 'all') && (
          <SheetRow icon="chatbubble-outline" label={'Message ' + m.senderName.split(' ')[0] + ' privately'} onPress={() => menuAction(() => messagePrivately(m))} />
        )}
        {!isBot && ps.commandsEnabled && chat.type !== 'checkin' && (
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
      if (day !== prev) { asc.push({ kind: 'date', key: 'd' + day, label: dayLabel(m.createdAt) }); prev = day; }
      if (!unreadShown && m.id && m.id > from && m.senderId !== me.id && m.type !== 'system') {
        unreadShown = true;
        asc.push({ kind: 'unread', key: 'unread', count: unreadCount });
      }
      const quote = kind === 'ai' && m.type === 'bot' && m.sourceMessageId ? seenSrc.current.get(m.sourceMessageId) || null : null;
      asc.push({ kind: 'msg', key: m.clientId || String(m.id), msg: m, attachments: m.id ? att.get(m.id) : undefined, quote });
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
    if (!m.id) return 'pending';
    if (m.id <= status.read) return 'read';
    if (m.id <= status.delivered) return 'delivered';
    return 'sent';
  };

  // ---- composer suggestions: @mentions, slash palette, my tasks after "/done #" ----
  const taskCmd = /^\/(\w+)\s+#(\S*)$/.exec(text);
  const needsTasks = !!taskCmd && ps.commandsEnabled && COMMANDS.some((c) => c.cmd === '/' + taskCmd[1] && c.needsTask);
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
    return '#' + x.id + (who ? '  ·  ' + who : '') + (!isBrief(x) && x.project ? '  ·  ' + x.project : '');
  };
  const matchTask = (x: AnyTask, q: string) =>
    !q || String(x.id).startsWith(q) || x.title.toLowerCase().includes(q) || assigneeNamesOf(x).some((n) => n.toLowerCase().includes(q));

  const suggestions: Suggestion[] = (() => {
    if (voice.recording) return [];
    if (needsTasks && taskCmd) {
      const q = taskCmd[2].toLowerCase();
      return ((isAsk ? askTasks : myTasks) ?? [])
        .filter((x) => matchTask(x, q))
        .slice(0, 8)
        .map((x) => ({
          key: 't' + x.id, title: x.title, sub: taskSub(x),
          left: <Ionicons name="checkbox-outline" size={20} color={colorOf(x.status)} />,
          right: statusTag(x.status),
          onPress: () => {
            const cmd = taskCmd[1].toLowerCase();
            const base = '/' + taskCmd[1] + ' #' + x.id + ' ';
            if (PEOPLE_CMD[cmd]) pickPeopleFor(cmd, base);
            else put(base);
          },
        }));
    }
    if (hashQ && ps.commandsEnabled) {
      const q = hashQ[2];
      return (myTasks ?? []).filter((x) => matchTask(x, q)).slice(0, 6).map((x) => ({
        key: 'h' + x.id, title: x.title, sub: taskSub(x),
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
        onPress: () => { setText(c.cmd + ' '); inputRef.current?.focus(); },
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
  const showChips = helpers && focused && !text && !voice.recording && !editing && !suggestions.length;
  const quick = QUICK.map((q) => COMMANDS.find((c) => c.cmd === q)!).filter(Boolean);
  const smallBtn = (label: string, onPress: () => void, a11y: string, icon?: keyof typeof Ionicons.glyphMap) => (
    <Pressable
      onPress={onPress} accessibilityLabel={a11y} hitSlop={4}
      style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.border }}>
        {icon
          ? <Ionicons name={icon} size={17} color={t.accent} />
          : <Text style={{ color: t.accent, fontSize: 17, fontWeight: '800', includeFontPadding: false }}>{label}</Text>}
      </View>
    </Pressable>
  );
  // second composer button: DM = tasks with this person, check-in = new task (for me), else "@" person actions
  const personBtn = () =>
    chat.type === 'dm' && chat.otherUserId ? smallBtn('', () => setSheet('dmTasks'), 'Tasks', 'clipboard-outline')
      : chat.type === 'checkin' ? smallBtn('', () => setSheet('newTask'), 'Naya task', 'add-circle-outline')
      : smallBtn('@', openPersonActions, 'Person');

  const renderItem = useCallback(({ item }: { item: Item }) =>
    item.kind === 'date' ? (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ backgroundColor: t.card, color: t.subtext, fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' }}>
          {item.label}
        </Text>
      </View>
    ) : item.kind === 'unread' ? (
      <View style={{ alignItems: 'center', marginVertical: 8 }}>
        <Text style={{ backgroundColor: 'rgba(37,211,102,0.2)', color: t.text, fontSize: 12, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' }}>
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
        highlight={!!item.msg.id && item.msg.id === flashId}
        attachments={item.attachments}
        quote={item.quote}
        onTaskChip={onTaskChip}
      />
    ), [t, me.id, me.name, me.role, chat.type, status, flashId, longPress, startReply, jumpTo, react, openTask, onSendText, put, cardMic, onTaskChip]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Pressable onPress={() => hasInfo && onOpenInfo(chat)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {chat.type === 'dm' && chat.otherUserId
            ? <Avatar name={chat.name} id={chat.otherUserId} userId={chat.otherUserId} emoji={chat.otherUserEmoji} size={38} />
            : <Avatar name={chat.name} id={chat.id} size={38} />}
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{chat.name}</Text>
            {!!subtitle && <Text style={{ color: '#D0E8E4', fontSize: 12 }}>{subtitle}</Text>}
          </View>
        </Pressable>
      </View>
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
      <View style={{ flex: 1 }}>
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
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13 }}>{replyTo.text || ''}</Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={10} style={{ padding: 8 }}>
            <Ionicons name="close" size={22} color={t.subtext} />
          </Pressable>
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
      {showChips && (
        <ScrollView
          horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 2, alignItems: 'center' }}
        >
          {quick.map((c) => (
            <Pressable
              key={c.cmd} onPress={() => pickCommand(c)}
              style={{ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: t.card, marginRight: 6, borderWidth: 1, borderColor: t.border }}
            >
              <Ionicons name={c.icon} size={15} color={t.accent} />
              <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', marginLeft: 5 }}>{c.cmd}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={openPersonActions}
            style={{ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: t.card, borderWidth: 1, borderColor: t.border }}
          >
            <Ionicons name="at" size={15} color={t.accent} />
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '600', marginLeft: 5 }}>person</Text>
          </Pressable>
        </ScrollView>
      )}
      {voice.recording ? (
        <VoiceBar
          t={t} levels={voice.levels} transcript={voice.transcript} lang={voice.lang} bottom={insets.bottom}
          onToggleLang={voice.toggleLang} onCancel={() => { cardTarget.current = null; voice.cancel(); }} onStop={voiceStop} onSend={voiceSend}
        />
      ) : (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: 8 + insets.bottom }}>
        {helpers && !editing && smallBtn('/', () => setSheet('cmd'), 'Commands')}
        {helpers && !editing && personBtn()}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Message"
          placeholderTextColor={t.subtext}
          multiline
          style={{
            flex: 1, maxHeight: 120, backgroundColor: t.card, color: t.text, borderRadius: 22,
            paddingHorizontal: 14, paddingVertical: 8, fontSize: 16,
          }}
        />
        {voice.available && !text.trim() && !editing ? (
          <MicButton t={t} onPress={() => { cardTarget.current = null; voice.start(toBox); }} />
        ) : (
          <Pressable
            onPress={() => send()}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
          >
            {editing ? <Ionicons name="checkmark" size={24} color="#fff" /> : <Text style={{ color: '#fff', fontSize: 20 }}>{'➤'}</Text>}
          </Pressable>
        )}
      </View>
      )}
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.senderName}>{renderMenu()}</Sheet>
      <CommandSheet visible={sheet === 'cmd'} onClose={() => setSheet(null)} onPick={pickCommand} />
      <PeopleSheet
        visible={sheet === 'people'} onClose={() => { peoplePick.current = null; peoplePickMany.current = null; setSheet(null); }} title={peopleTitle}
        people={pickList} loading={!storeUsers.length} onPick={pickedPerson}
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
    </KeyboardAvoidingView>
  );
}
