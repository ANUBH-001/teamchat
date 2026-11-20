// Round 4: "Send to..." chat picker (top camera -> choose a chat). Phase 3 can reuse it for forwarding.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../useTheme';
import { Chat } from '../chatTypes';
import Avatar from './Avatar';
import Sheet from './Sheet';

export default function SendToSheet({ visible, onClose, chats, onPick, title = 'Send to...' }: {
  visible: boolean; onClose: () => void; chats: Chat[]; onPick: (c: Chat) => void; title?: string;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const list = chats.filter((c) => c.type !== 'checkin' && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TextInput
          value={q} onChangeText={setQ} placeholder="Search chats" placeholderTextColor={t.subtext}
          style={{ backgroundColor: t.surface, color: t.text, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
        />
      </View>
      {list.map((c) => (
        <Pressable
          key={c.id} onPress={() => onPick(c)} android_ripple={{ color: t.border }}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 20 }}
        >
          {c.type === 'dm' && c.otherUserId
            ? <Avatar name={c.name} id={c.otherUserId} userId={c.otherUserId} emoji={c.otherUserEmoji} size={40} />
            : <Avatar name={c.name} id={c.id} size={40} />}
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, marginLeft: 14 }}>{c.name}</Text>
        </Pressable>
      ))}
      {list.length === 0 && <Text style={{ color: t.subtext, textAlign: 'center', padding: 24 }}>No chats</Text>}
    </Sheet>
  );
}
