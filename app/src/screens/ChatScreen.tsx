import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform, AppState, ActivityIndicator, Share,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat, Msg, ReplyRef, Reaction } from '../chatTypes';
import { Task } from '../taskTypes';
import { onEvent, sendTyping } from '../realtime';
import { enqueue, flushOutbox, newClientId, onSent, pendingFor, removeFromOutbox } from '../outbox';
import { COMMANDS } from '../commands';
import { usePublicSettings } from '../publicSettings';
import Avatar from '../components/Avatar';
import Bubble from '../components/Bubble';
import Sheet, { SheetRow } from '../components/Sheet';
import Suggestions, { Suggestion } from '../components/Suggestions';
import { TickStatus } from '../components/Tick';
import VoiceBar, { MicButton } from '../components/VoiceBar';
import { copyText } from '../dates';
import { toast, useVoiceInput } from '../useVoiceInput';

type Item =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'msg'; key: string; msg: Msg };
type Member = { id: number; name: string; role: 'boss' | 'member'; isCreator: boolean };

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
};

export default function ChatScreen({ chat, onBack, onOpenInfo, onOpenTask, onOpenChat }: Props) {
  const t = useTheme();
  const { user } = useAuth();
  const ps = usePublicSettings();
  const insets = useSafeAreaInsets();
  const me = user!;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState({ delivered: 0, read: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [menu, setMenu] = useState<Msg | null>(null);
  const [pinned, setPinned] = useState(chat.pinnedMessage ?? null);
  const [members, setMembers] = useState<Member[]>([]);
  const [myTasks, setMyTasks] = useState<Task[] | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [belowCount, setBelowCount] = useState(0);
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
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean; status: any }>('GET', '/chats/' + chat.id + '/messages?limit=30');
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
      const r = await api<{ messages: Msg[]; status: any }>('GET', '/chats/' + chat.id + '/messages?after=' + last);
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
    try {
      const r = await api<{ messages: Msg[]; hasMore: boolean }>('GET', '/chats/' + chat.id + '/messages?limit=30&before=' + first);
      setMsgs((cur) => merge(cur, r.messages));
      setHasMore(r.hasMore);
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

  const voice = useVoiceInput();

  const send = (raw = text, keepReply = false) => {
    const body = raw.trim();
    if (!body) return;
    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    const rt = keepReply ? null : replyTo;
    const ref: ReplyRef | null = rt && rt.id
      ? { id: rt.id, senderName: rt.senderName, text: (rt.text || '').slice(0, 200), deleted: false }
      : null;
    setMsgs((cur) => merge(cur, [{
      clientId, chatId: chat.id, senderId: me.id, senderName: me.name, text: body, deleted: false, createdAt, pending: true,
      replyTo: ref,
    }]));
    if (!keepReply) { setText(''); setReplyTo(null); }
    enqueue(chat.id, body, clientId, createdAt, ref);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
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
    if (m.type === 'bot' && me.role !== 'boss') return;
    setMenu(m);
  }, [me.role]);

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
    const isBot = m.type === 'bot';
    const canDelete = m.senderId === me.id || me.role === 'boss';
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
        {!!m.id && !isBot && <SheetRow icon="arrow-undo-outline" label="Reply" onPress={() => menuAction(() => startReply(m))} />}
        {!isBot && !!m.text && <SheetRow icon="copy-outline" label="Copy" onPress={() => menuAction(() => copyText(m.text || ''))} />}
        {!!m.id && !isBot && chat.type !== 'checkin' && (
          <SheetRow icon="pin-outline" label={pinned && pinned.id === m.id ? 'Unpin' : 'Pin'} onPress={() => menuAction(() => togglePin(m))} />
        )}
        {!!m.id && m.senderId !== me.id && !isBot && (chat.type === 'group' || chat.type === 'all') && (
          <SheetRow icon="chatbubble-outline" label={'Message ' + m.senderName.split(' ')[0] + ' privately'} onPress={() => menuAction(() => messagePrivately(m))} />
        )}
        {!isBot && ps.commandsEnabled && chat.type !== 'checkin' && (
          <SheetRow
            icon="checkbox-outline" label="Make task"
            onPress={() => menuAction(() => {
              setText('/task ' + (m.senderId !== me.id ? '@' + m.senderName.split(' ')[0] + ' ' : ''));
              inputRef.current?.focus();
            })}
          />
        )}
        {canDelete && <SheetRow icon="trash-outline" label="Delete" danger onPress={() => menuAction(() => doDelete(m))} />}
      </>
    );
  };

  // ---- list items ----
  const items = useMemo(() => {
    const asc: Item[] = [];
    let prev = '';
    let unreadShown = unreadFrom.current === null;
    const from = unreadFrom.current ?? 0;
    const unreadCount = unreadFrom.current === null ? 0
      : msgs.filter((m) => m.id && m.id > from && m.senderId !== me.id && m.type !== 'system').length;
    for (const m of msgs) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== prev) { asc.push({ kind: 'date', key: 'd' + day, label: dayLabel(m.createdAt) }); prev = day; }
      if (!unreadShown && m.id && m.id > from && m.senderId !== me.id && m.type !== 'system') {
        unreadShown = true;
        asc.push({ kind: 'unread', key: 'unread', count: unreadCount });
      }
      asc.push({ kind: 'msg', key: m.clientId || String(m.id), msg: m });
    }
    return asc.reverse();
  }, [msgs, me.id]);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // tap on a quote / the pinned bar: scroll to the original if it is loaded
  const jumpTo = useCallback((id: number) => {
    const idx = itemsRef.current.findIndex((i) => i.kind === 'msg' && i.msg.id === id);
    if (idx < 0) { toast('Original message is not loaded'); return; }
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }, []);

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
  useEffect(() => {
    if (!needsTasks) return;
    api<{ tasks: Task[] }>('GET', '/tasks?assignee=' + me.id)
      .then((r) => setMyTasks(r.tasks.filter((x) => x.status !== 'done'))).catch(() => {});
  }, [needsTasks, me.id]);

  const suggestions: Suggestion[] = (() => {
    if (voice.recording) return [];
    if (needsTasks && taskCmd) {
      const q = taskCmd[2].toLowerCase();
      return (myTasks ?? [])
        .filter((x) => !q || String(x.id).startsWith(q) || x.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((x) => ({
          key: 't' + x.id, title: x.title, sub: '#' + x.id + (x.project ? '  ·  ' + x.project : ''),
          left: <Ionicons name="checkbox-outline" size={20} color={t.accent} />,
          onPress: () => setText('/' + taskCmd[1] + ' #' + x.id + ' '),
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
      return members
        .filter((m) => m.id !== me.id && (!q || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))))
        .slice(0, 6)
        .map((m) => ({
          key: 'm' + m.id, title: m.name, sub: m.role === 'boss' ? 'Admin' : undefined,
          left: <Avatar name={m.name} id={m.id} size={32} />,
          onPress: () => setText(text.slice(0, text.length - mm[2].length) + m.name.split(' ')[0] + ' '),
        }));
    }
    return [];
  })();

  const subtitle = typingName
    ? (chat.type === 'dm' ? 'typing...' : typingName + ' is typing...')
    : chat.type === 'checkin' ? 'Aapke reports admin dekh sakte hain'
    : chat.type === 'dm' ? '' : (members.length || chat.membersCount) + ' members';
  const hasInfo = chat.type === 'group' || chat.type === 'all';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Pressable onPress={() => hasInfo && onOpenInfo(chat)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={chat.name} id={chat.id} size={38} />
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{chat.name}</Text>
            {!!subtitle && <Text style={{ color: '#D0E8E4', fontSize: 12 }}>{subtitle}</Text>}
          </View>
        </Pressable>
      </View>
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
          renderItem={({ item }) =>
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
                onOpenTask={onOpenTask}
                onSendText={(x) => send(x, true)}
                onCardMic={cardMic}
                meId={me.id}
                meName={me.name}
                isBoss={me.role === 'boss'}
                highlight={!!item.msg.id && item.msg.id === flashId}
              />
            )
          }
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
      <Suggestions items={suggestions} t={t} />
      {voice.recording ? (
        <VoiceBar
          t={t} levels={voice.levels} transcript={voice.transcript} lang={voice.lang} bottom={insets.bottom}
          onToggleLang={voice.toggleLang} onCancel={() => { cardTarget.current = null; voice.cancel(); }} onStop={voiceStop} onSend={voiceSend}
        />
      ) : (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: 8 + insets.bottom }}>
        {ps.commandsEnabled && chat.type !== 'checkin' && (
          <Pressable
            onPress={() => { setText((cur) => (cur.startsWith('/') ? cur : '/' + cur)); inputRef.current?.focus(); }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}
          >
            <Ionicons name="checkbox-outline" size={24} color={t.accent} />
          </Pressable>
        )}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={onChange}
          placeholder="Message"
          placeholderTextColor={t.subtext}
          multiline
          style={{
            flex: 1, maxHeight: 120, backgroundColor: t.card, color: t.text, borderRadius: 22,
            paddingHorizontal: 14, paddingVertical: 8, fontSize: 16,
          }}
        />
        {voice.available && !text.trim() ? (
          <MicButton t={t} onPress={() => { cardTarget.current = null; voice.start(toBox); }} />
        ) : (
          <Pressable
            onPress={() => send()}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
          >
            <Text style={{ color: '#fff', fontSize: 20 }}>{'➤'}</Text>
          </Pressable>
        )}
      </View>
      )}
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.senderName}>{renderMenu()}</Sheet>
    </KeyboardAvoidingView>
  );
}
