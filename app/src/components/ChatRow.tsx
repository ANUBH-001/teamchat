import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Theme } from '../theme';
import Avatar from './Avatar';
import { Chat } from '../chatTypes';

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString();
}

function ChatRowBase({ chat, t, meId, onPress }: { chat: Chat; t: Theme; meId: number; onPress: (c: Chat) => void }) {
  const lm = chat.lastMessage;
  let preview = 'No messages yet';
  if (lm) {
    const body = lm.deleted ? 'This message was deleted' : lm.text ?? '';
    const who = lm.senderId === meId ? 'You: ' : chat.type !== 'dm' ? lm.senderName + ': ' : '';
    preview = who + body;
  }
  return (
    <Pressable
      onPress={() => onPress(chat)}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10,
        backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border,
      }}
    >
      <Avatar name={chat.name} id={chat.id} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '600' }}>
            {chat.type === 'all' ? '📌 ' : ''}{chat.name}
          </Text>
          {lm && (
            <Text style={{ color: chat.unread ? t.accent : t.subtext, fontSize: 12, marginLeft: 8 }}>{when(lm.createdAt)}</Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: t.subtext, fontSize: 14, fontStyle: lm?.deleted ? 'italic' : 'normal' }}
          >
            {preview}
          </Text>
          {chat.unread > 0 && (
            <View
              style={{
                backgroundColor: t.accent, minWidth: 20, height: 20, borderRadius: 10,
                alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default React.memo(ChatRowBase);
