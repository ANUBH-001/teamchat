import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, Alert, BackHandler, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat } from '../chatTypes';
import { onEvent } from '../realtime';
import { useLiveRefresh, usePullRefresh } from '../useLive';
import { takePendingChat, takePendingMessage, setActiveChat, setChatPrefs } from '../push';
import ChatRow from '../components/ChatRow';
import ChatScreen from './ChatScreen';
import NewChatScreen from './NewChatScreen';
import GroupInfoScreen from './GroupInfoScreen';
import TaskDetailScreen from './TaskDetailScreen';
import Sheet, { SheetRow } from '../components/Sheet';

type View_ =
  | { k: 'list' } | { k: 'chat'; chat: Chat; focusId?: number | null } | { k: 'new'; mode: 'dm' | 'group' }
  | { k: 'info'; chat: Chat } | { k: 'task'; id: number; chat: Chat; from?: 'info' };

export default function ChatsScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>({ k: 'list' });
  const [chats, setChats] = useState<Chat[]>([]);
  const [q, setQ] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [rowMenu, setRowMenu] = useState<Chat | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    setActiveChat(view.k === 'chat' || view.k === 'info' ? view.chat.id : null);
    return () => setActiveChat(null);
  }, [view]);

  const load = useCallback(async () => {
    try {
      const list = (await api<{ chats: Chat[] }>('GET', '/chats')).chats;
      setChats(list);
      setChatPrefs(list);
      // keep the open chat's header data (name, pin, member count) fresh
      setView((v) => {
        if (v.k !== 'chat' && v.k !== 'info' && v.k !== 'task') return v;
        const c = list.find((x) => x.id === v.chat.id);
        if (!c || (c.name === v.chat.name && c.membersCount === v.chat.membersCount && !!c.muted === !!v.chat.muted)) return v;
        return { ...v, chat: c };
      });
    } catch (e) {}
    setLoaded(true);
  }, []);

  // notification tap -> open that chat
  const openChat = useCallback(async (id: number, focusId: number | null = null) => {
    try {
      const list = (await api<{ chats: Chat[] }>('GET', '/chats')).chats;
      setChats(list);
      setChatPrefs(list);
      const c = list.find((x) => x.id === id);
      if (c) setView({ k: 'chat', chat: c, focusId });
    } catch (e) {}
  }, []);

  useEffect(() => {
    load();
    const pending = takePendingChat();
    const pendingMsg = takePendingMessage();
    if (pending) openChat(pending, pendingMsg);
    return onEvent((e) => {
      if (e.type === '_open_chat') { takePendingChat(); takePendingMessage(); openChat(e.chatId, e.messageId || null); }
    });
  }, [load, openChat]);

  // chat list stays live: new/deleted messages, new chats, reconnect, app foreground, manual refresh
  useLiveRefresh(load, ['message', 'deleted', 'chat', 'edited', 'reset', 'purged']);
  const { refreshing, onRefresh } = usePullRefresh(load);
  const openRow = useCallback((c: Chat) => setView({ k: 'chat', chat: c }), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const v = viewRef.current;
      if (v.k === 'list') return false;
      if (v.k === 'task' && v.from === 'info') { setView({ k: 'info', chat: v.chat }); return true; }
      if (v.k === 'info' || v.k === 'task') { setView({ k: 'chat', chat: v.chat }); return true; }
      setView({ k: 'list' });
      load();
      return true;
    });
    return () => sub.remove();
  }, [load]);

  const back = () => { setView({ k: 'list' }); load(); };

  const openChat2 = (c: Chat) => setView({ k: 'chat', chat: c });
  if (view.k === 'chat') {
    return (
      <ChatScreen
        key={view.chat.id} chat={view.chat} focusId={view.focusId || null} onBack={back} onOpenInfo={(c) => setView({ k: 'info', chat: c })}
        onOpenTask={(id) => setView({ k: 'task', id, chat: view.chat })} onOpenChat={openChat2}
      />
    );
  }
  if (view.k === 'info') {
    return <GroupInfoScreen chat={view.chat} onBack={() => setView({ k: 'chat', chat: view.chat })} onChanged={load} onLeft={back} onOpenChat={openChat2}
      onOpenTask={(id) => setView({ k: 'task', id, chat: view.chat, from: 'info' })} />;
  }
  if (view.k === 'task') return <TaskDetailScreen taskId={view.id} onBack={() => setView({ k: view.from || 'chat', chat: view.chat })} />;
  if (view.k === 'new') {
    return <NewChatScreen mode={view.mode} onBack={back} onOpen={(c) => { setView({ k: 'chat', chat: c }); }} />;
  }

  const prefs = async (body: { pinned?: boolean; muted?: boolean }) => {
    const c = rowMenu;
    setRowMenu(null);
    if (!c) return;
    try { await api('PATCH', '/chats/' + c.id + '/me', body); } catch (e: any) { Alert.alert('Error', e.message); }
    load();
  };
  const shown = chats.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const fab = () =>
    Alert.alert('New', undefined, [
      { text: 'New group', onPress: () => setView({ k: 'new', mode: 'group' }) },
      { text: 'New chat', onPress: () => setView({ k: 'new', mode: 'dm' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: t.card }}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 10, paddingBottom: 10, paddingHorizontal: 14 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>Team Chat</Text>
      </View>
      <TextInput
        value={q} onChangeText={setQ} placeholder="Search chats" placeholderTextColor={t.subtext}
        style={{ margin: 10, backgroundColor: t.background, color: t.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
      />
      <FlatList
        data={shown}
        keyExtractor={(c) => String(c.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        initialNumToRender={14}
        windowSize={9}
        renderItem={({ item }) => <ChatRow chat={item} t={t} meId={user!.id} onPress={openRow} onLongPress={setRowMenu} />}
        ListEmptyComponent={
          loaded
            ? <Text style={{ color: t.subtext, textAlign: 'center', marginTop: 40 }}>{q ? 'No chats match' : 'No chats yet'}</Text>
            : <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
        }
      />
      <Sheet visible={!!rowMenu} onClose={() => setRowMenu(null)} title={rowMenu?.name}>
        <SheetRow
          icon="pin-outline" label={rowMenu?.pinned ? 'Unpin chat' : 'Pin chat'}
          onPress={() => prefs({ pinned: !rowMenu?.pinned })}
        />
        <SheetRow
          icon={rowMenu?.muted ? 'volume-high-outline' : 'volume-mute-outline'} label={rowMenu?.muted ? 'Unmute' : 'Mute'}
          onPress={() => prefs({ muted: !rowMenu?.muted })}
        />
      </Sheet>
      <Pressable
        onPress={fab}
        style={{
          position: 'absolute', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28,
          backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 5,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 30, lineHeight: 34 }}>+</Text>
      </Pressable>
    </View>
  );
}
