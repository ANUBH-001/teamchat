import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, Alert, KeyboardAvoidingView, Platform, AppState, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat, Msg, ReplyRef } from '../chatTypes';
import { onEvent, sendTyping } from '../realtime';
import { enqueue, flushOutbox, newClientId, onSent, pendingFor, removeFromOutbox } from '../outbox';
import Avatar from '../components/Avatar';
import Bubble from '../components/Bubble';
import { TickStatus } from '../components/Tick';
import VoiceBar, { MicButton } from '../components/VoiceBar';
import { toast, useVoiceInput } from '../useVoiceInput';

type Item = { kind: 'date'; key: string; label: string } | { kind: 'msg'; key: string; msg: Msg };

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

export default function ChatScreen({ chat, onBack }: { chat: Chat; onBack: () => void }) {
  const t = useTheme();
  const { user } = useAuth();
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
  const listRef = useRef<FlatList<Item>>(null);
  const inputRef = useRef<TextInput>(null);
  const loadingOlder = useRef(false);
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
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

  useEffect(() => {
    loadLatest();
    flushOutbox();
    const offSent = onSent((clientId, message) => {
      if (message.chatId === chat.id) setMsgs((cur) => merge(cur, [message]));
    });
    const off = onEvent((e) => {
      if (e.type === '_open') { loadMissed(); flushOutbox(); }
      else if (e.type === 'message' && e.message.chatId === chat.id) {
        synced([e.message]);
        setMsgs((cur) => merge(cur, [e.message]));
        if (e.message.senderId !== me.id) markRead();
      } else if (e.type === 'deleted' && e.chatId === chat.id) {
        markDeleted(e.messageId);
      } else if (e.type === 'read' && e.chatId === chat.id) {
        setStatus({ delivered: e.delivered, read: e.read });
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

  const send = (raw = text) => {
    const body = raw.trim();
    if (!body) return;
    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    const ref: ReplyRef | null = replyTo && replyTo.id
      ? { id: replyTo.id, senderName: replyTo.senderName, text: (replyTo.text || '').slice(0, 200), deleted: false }
      : null;
    setMsgs((cur) => merge(cur, [{
      clientId, chatId: chat.id, senderId: me.id, senderName: me.name, text: body, deleted: false, createdAt, pending: true,
      replyTo: ref,
    }]));
    setText('');
    setReplyTo(null);
    enqueue(chat.id, body, clientId, createdAt, ref);
  };

  // voice: stop -> transcript goes into the text box to edit; send -> sent at once; X -> discarded
  const toBox = (said: string) => {
    if (!said) { toast('Kuch sunai nahi diya'); return; }
    setText((cur) => (cur ? cur + ' ' + said : said));
  };
  const voiceStop = async () => toBox(await voice.finish());
  const voiceSend = async () => {
    const said = await voice.finish();
    if (!said) { toast('Kuch sunai nahi diya'); return; }
    send(said);
  };

  const onChange = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v && now - lastTypingSent.current > 2000) { lastTypingSent.current = now; sendTyping(chat.id); }
  };

  const longPress = useCallback((m: Msg) => {
    if (m.deleted) return;
    if (m.senderId !== me.id && me.role !== 'boss') return;
    Alert.alert('Message', undefined, [
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (!m.id) {
            await removeFromOutbox(m.clientId);
            setMsgs((cur) => cur.filter((x) => x.clientId !== m.clientId));
            return;
          }
          try {
            await api('DELETE', '/messages/' + m.id);
            markDeleted(m.id);
          } catch (e: any) { Alert.alert('Could not delete', e.message); }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [me.id, me.role, markDeleted]);

  const startReply = useCallback((m: Msg) => {
    if (!m.id || m.deleted) return;
    setReplyTo(m);
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const asc: Item[] = [];
    let prev = '';
    for (const m of msgs) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== prev) { asc.push({ kind: 'date', key: 'd' + day, label: dayLabel(m.createdAt) }); prev = day; }
      asc.push({ kind: 'msg', key: m.clientId || String(m.id), msg: m });
    }
    return asc.reverse();
  }, [msgs]);

  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  // tap on a quote: scroll to the original if it is loaded
  const jumpTo = useCallback((id: number) => {
    const idx = itemsRef.current.findIndex((i) => i.kind === 'msg' && i.msg.id === id);
    if (idx < 0) { toast('Original message is not loaded'); return; }
    listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }, []);

  const tickOf = (m: Msg): TickStatus => {
    if (!m.id) return 'pending';
    if (m.id <= status.read) return 'read';
    if (m.id <= status.delivered) return 'delivered';
    return 'sent';
  };

  const subtitle = typingName
    ? (chat.type === 'dm' ? 'typing...' : typingName + ' is typing...')
    : chat.type === 'dm' ? '' : chat.membersCount + ' members';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Avatar name={chat.name} id={chat.id} size={38} />
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 17, fontWeight: '600' }}>{chat.name}</Text>
          {!!subtitle && <Text style={{ color: '#D0E8E4', fontSize: 12 }}>{subtitle}</Text>}
        </View>
      </View>
      <FlatList
        ref={listRef}
        inverted
        data={items}
        keyExtractor={(i) => i.key}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.5}
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
          <View style={{ transform: [{ scaleY: -1 }], padding: 30, alignItems: 'center' }}>
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
          ) : (
            <Bubble
              msg={item.msg}
              mine={item.msg.senderId === me.id}
              showSender={chat.type !== 'dm'}
              status={tickOf(item.msg)}
              t={t}
              onLongPress={longPress}
              onReply={startReply}
              onQuotePress={jumpTo}
              meId={me.id}
              isBoss={me.role === 'boss'}
              highlight={!!item.msg.id && item.msg.id === flashId}
            />
          )
        }
      />
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
      {voice.recording ? (
        <VoiceBar
          t={t} levels={voice.levels} transcript={voice.transcript} lang={voice.lang} bottom={insets.bottom}
          onToggleLang={voice.toggleLang} onCancel={voice.cancel} onStop={voiceStop} onSend={voiceSend}
        />
      ) : (
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: 8 + insets.bottom }}>
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
          <MicButton t={t} onPress={() => voice.start(toBox)} />
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
    </KeyboardAvoidingView>
  );
}
