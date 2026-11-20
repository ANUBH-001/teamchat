import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, Alert, BackHandler, RefreshControl, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import SendToSheet from '../components/SendToSheet';
import SettingsScreen from './SettingsScreen';
import AdminScreen from './AdminScreen';
import { pickPhoto, saveToGallery, sendImageToChat } from '../media';
import { getPrefs } from '../prefs';
import StarredScreen from './StarredScreen';
import { useNavigation } from '@react-navigation/native';
import { tabBarStyleFor } from '../theme';

type View_ =
  | { k: 'list' } | { k: 'chat'; chat: Chat; focusId?: number | null } | { k: 'new'; mode: 'dm' | 'group' }
  | { k: 'info'; chat: Chat } | { k: 'task'; id: number; chat: Chat; from?: 'info' }
  | { k: 'settings' } | { k: 'admin' } | { k: 'starred' }; // Round 4: Settings (from the menu) and Admin panel (boss, from Settings)

type Filter = 'all' | 'unread' | 'fav' | 'groups';
const FILTERS: { k: Filter; label: string }[] = [
  { k: 'all', label: 'All' }, { k: 'unread', label: 'Unread' }, { k: 'fav', label: 'Favourites' }, { k: 'groups', label: 'Groups' },
];

export default function ChatsScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>({ k: 'list' });
  // Round 4: hide the bottom tab bar inside a chat / sub-screen (WhatsApp)
  const nav = useNavigation<any>();
  useEffect(() => {
    nav.setOptions({ tabBarStyle: view.k === 'list' ? tabBarStyleFor(t) : { display: 'none' } });
  }, [view.k, t, nav]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [q, setQ] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [rowMenu, setRowMenu] = useState<Chat | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [menu, setMenu] = useState(false); // top-right ⋮ menu
  const [sendUri, setSendUri] = useState<string | null>(null); // top camera: photo waiting for a chat
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
      if (v.k === 'admin') { setView({ k: 'settings' }); return true; }
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
  // Round 4 Phase 3: Starred messages list (opens the chat scrolled to the message)
  if (view.k === 'starred') return <StarredScreen onBack={() => setView({ k: 'list' })} onOpen={(chatId, messageId) => openChat(chatId, messageId)} />;
  if (view.k === 'info') {
    return <GroupInfoScreen chat={view.chat} onBack={() => setView({ k: 'chat', chat: view.chat })} onChanged={load} onLeft={back} onOpenChat={openChat2}
      onOpenTask={(id) => setView({ k: 'task', id, chat: view.chat, from: 'info' })} />;
  }
  if (view.k === 'task') return <TaskDetailScreen taskId={view.id} onBack={() => setView({ k: view.from || 'chat', chat: view.chat })} />;
  if (view.k === 'new') {
    return <NewChatScreen mode={view.mode} onBack={back} onOpen={(c) => { setView({ k: 'chat', chat: c }); }} />;
  }

  // Round 4: Settings (WhatsApp-style) and the Admin panel (boss) are views of this screen too
  if (view.k === 'settings') return <SettingsScreen onBack={() => setView({ k: 'list' })} onOpenAdmin={() => setView({ k: 'admin' })} />;
  if (view.k === 'admin') return <AdminScreen onBack={() => setView({ k: 'settings' })} />;

  const prefs = async (body: { pinned?: boolean; muted?: boolean; favourite?: boolean }) => {
    const c = rowMenu;
    setRowMenu(null);
    if (!c) return;
    try { await api('PATCH', '/chats/' + c.id + '/me', body); } catch (e: any) { Alert.alert('Error', e.message); }
    load();
  };
  const markRead = async () => {
    const c = rowMenu;
    setRowMenu(null);
    if (!c) return;
    try { await api('POST', '/chats/' + c.id + '/read', c.lastMessage ? { messageId: c.lastMessage.id } : {}); } catch (e: any) { Alert.alert('Error', e.message); }
    load();
  };
  // search: chat name + last message preview text (local only)
  const ql = q.trim().toLowerCase();
  const shown = chats.filter((c) => {
    if (filter === 'unread' && !(c.unread > 0)) return false;
    if (filter === 'fav' && !c.favourite) return false;
    if (filter === 'groups' && c.type !== 'group' && c.type !== 'all') return false;
    if (!ql) return true;
    return c.name.toLowerCase().includes(ql) || (c.lastMessage?.text || '').toLowerCase().includes(ql);
  });
  const fab = () =>
    Alert.alert('New', undefined, [
      { text: 'New group', onPress: () => setView({ k: 'new', mode: 'group' }) },
      { text: 'New chat', onPress: () => setView({ k: 'new', mode: 'dm' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  // top camera: system camera -> save to gallery album "TeamChat" (if allowed + pref on) -> "Send to..." picker
  const openCamera = async () => {
    const uri = await pickPhoto('camera');
    if (!uri) return;
    if (getPrefs().saveToGallery) saveToGallery(uri); // denied permission / errors are ignored inside
    setSendUri(uri);
  };
  const sendTo = async (c: Chat) => {
    const uri = sendUri;
    setSendUri(null);
    if (!uri) return;
    try { await sendImageToChat(c.id, uri); setView({ k: 'chat', chat: c }); } catch (e: any) { Alert.alert('Photo nahi gayi', e.message || 'Error'); }
  };
  const menuGo = (fn: () => void) => { setMenu(false); setTimeout(fn, 350); }; // Android drops a Modal shown while another fades out

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ paddingTop: insets.top + 10, paddingBottom: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.accent, fontSize: 24, fontWeight: '800' }}>TeamChat</Text>
        <Pressable onPress={openCamera} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="camera-outline" size={26} color={t.text} />
        </Pressable>
        <Pressable onPress={() => setMenu(true)} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-vertical" size={22} color={t.text} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: t.surface, borderRadius: 24, paddingHorizontal: 14 }}>
        <Ionicons name="search" size={18} color={t.subtext} />
        <TextInput
          value={q} onChangeText={setQ} placeholder="Search chats & messages" placeholderTextColor={t.subtext}
          style={{ flex: 1, color: t.text, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 }}
        />
        {!!q && <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={t.subtext} /></Pressable>}
      </View>
      <View style={{ height: 44 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
          {FILTERS.map((f) => {
            const on = filter === f.k;
            return (
              <Pressable
                key={f.k} onPress={() => setFilter(f.k)}
                style={{ height: 34, paddingHorizontal: 16, borderRadius: 17, marginRight: 8, justifyContent: 'center', backgroundColor: on ? t.chip : t.surface }}
              >
                <Text style={{ color: on ? t.chipText : t.subtext, fontWeight: on ? '700' : '500', fontSize: 14 }}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
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
            ? <Text style={{ color: t.subtext, textAlign: 'center', marginTop: 40 }}>{q || filter !== 'all' ? 'No chats match' : 'No chats yet'}</Text>
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
        <SheetRow
          icon={rowMenu?.favourite ? 'star' : 'star-outline'} label={rowMenu?.favourite ? 'Remove from favourites' : 'Add to favourites'}
          onPress={() => prefs({ favourite: !rowMenu?.favourite })}
        />
        {!!rowMenu && rowMenu.unread > 0 && <SheetRow icon="checkmark-done-outline" label="Mark as read" onPress={markRead} />}
      </Sheet>
      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <SheetRow icon="people-outline" label="New group" onPress={() => menuGo(() => setView({ k: 'new', mode: 'group' }))} />
        <SheetRow icon="chatbubble-outline" label="New chat" onPress={() => menuGo(() => setView({ k: 'new', mode: 'dm' }))} />
        <SheetRow icon="star-outline" label="Starred messages" onPress={() => menuGo(() => setView({ k: 'starred' }))} />
        <SheetRow icon="settings-outline" label="Settings" onPress={() => menuGo(() => setView({ k: 'settings' }))} />
        {user?.role === 'boss' && <SheetRow icon="shield-checkmark-outline" label="Admin panel" onPress={() => menuGo(() => setView({ k: 'admin' }))} />}
      </Sheet>
      <SendToSheet visible={!!sendUri} onClose={() => setSendUri(null)} chats={chats} onPick={sendTo} />
      <Pressable
        onPress={fab}
        style={{
          position: 'absolute', right: 18, bottom: 18, width: 58, height: 58, borderRadius: 18,
          backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', elevation: 5,
        }}
      >
        <Ionicons name="chatbubble-ellipses" size={26} color={t.onAccent} />
      </Pressable>
    </View>
  );
}
