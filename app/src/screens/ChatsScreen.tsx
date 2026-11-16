import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, Alert, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../useTheme';
import { Chat } from '../chatTypes';
import { onEvent } from '../realtime';
import { takePendingChat, setActiveChat } from '../push';
import ChatRow from '../components/ChatRow';
import ChatScreen from './ChatScreen';
import NewChatScreen from './NewChatScreen';

type View_ = { k: 'list' } | { k: 'chat'; chat: Chat } | { k: 'new'; mode: 'dm' | 'group' };

export default function ChatsScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<View_>({ k: 'list' });
  const [chats, setChats] = useState<Chat[]>([]);
  const [q, setQ] = useState('');
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    setActiveChat(view.k === 'chat' ? view.chat.id : null);
    return () => setActiveChat(null);
  }, [view]);

  const load = useCallback(async () => {
    try { setChats((await api<{ chats: Chat[] }>('GET', '/chats')).chats); } catch (e) {}
  }, []);

  // notification tap -> open that chat
  const openChat = useCallback(async (id: number) => {
    try {
      const list = (await api<{ chats: Chat[] }>('GET', '/chats')).chats;
      setChats(list);
      const c = list.find((x) => x.id === id);
      if (c) setView({ k: 'chat', chat: c });
    } catch (e) {}
  }, []);

  useEffect(() => {
    load();
    const pending = takePendingChat();
    if (pending) openChat(pending);
    let tm: ReturnType<typeof setTimeout> | null = null;
    const off = onEvent((e) => {
      if (e.type === '_open_chat') { takePendingChat(); openChat(e.chatId); return; }
      if (['message', 'deleted', 'chat', '_open'].includes(e.type)) {
        if (tm) clearTimeout(tm);
        tm = setTimeout(load, 300);
      }
    });
    return () => { off(); if (tm) clearTimeout(tm); };
  }, [load, openChat]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (viewRef.current.k === 'list') return false;
      setView({ k: 'list' });
      load();
      return true;
    });
    return () => sub.remove();
  }, [load]);

  const back = () => { setView({ k: 'list' }); load(); };

  if (view.k === 'chat') return <ChatScreen chat={view.chat} onBack={back} />;
  if (view.k === 'new') {
    return <NewChatScreen mode={view.mode} onBack={back} onOpen={(c) => { setView({ k: 'chat', chat: c }); }} />;
  }

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
        renderItem={({ item }) => (
          <ChatRow chat={item} t={t} meId={user!.id} onPress={() => setView({ k: 'chat', chat: item })} />
        )}
        ListEmptyComponent={<Text style={{ color: t.subtext, textAlign: 'center', marginTop: 40 }}>No chats</Text>}
      />
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
