import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import Avatar from './Avatar';
import { Chat } from '../chatTypes';

function when(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  // Round 4: WhatsApp style - weekday within a week, else dd/mm/yy
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2);
}

function ChatRowBase({ chat, t, meId, onPress, onLongPress }: { chat: Chat; t: Theme; meId: number; onPress: (c: Chat) => void; onLongPress: (c: Chat) => void }) {
  const lm = chat.lastMessage;
  let preview = 'No messages yet';
  if (lm) {
    const kind = lm.type;
    // Round 4: media previews come from the server as text; fall back to a label when it is empty
    const body = lm.deleted ? 'This message was deleted' : lm.text || (kind === 'image' ? '📷 Photo' : kind === 'audio' ? '🎤 Voice message' : '');
    const who = kind === 'bot' || kind === 'system' ? '' : lm.senderId === meId ? 'You: ' : chat.type === 'group' || chat.type === 'all' ? lm.senderName + ': ' : '';
    preview = (kind === 'bot' && !lm.deleted ? '📋 ' : '') + who + body;
  }
  return (
    <Pressable
      onPress={() => onPress(chat)}
      onLongPress={() => onLongPress(chat)}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10,
        backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border,
      }}
    >
      {chat.type === 'dm' && chat.otherUserId
        ? <Avatar name={chat.name} id={chat.otherUserId} userId={chat.otherUserId} emoji={chat.otherUserEmoji} />
        : <Avatar name={chat.name} id={chat.id} />}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '600' }}>
            {chat.type === 'all' ? '📌 ' : chat.type === 'checkin' ? '📝 ' : ''}{chat.name}
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
          {!!chat.favourite && <Ionicons name="star" size={14} color={t.subtext} style={{ marginLeft: 6 }} />}
          {!!chat.muted && <Ionicons name="volume-mute" size={15} color={t.subtext} style={{ marginLeft: 6 }} />}
          {!!chat.pinned && <Ionicons name="pin" size={15} color={t.subtext} style={{ marginLeft: 6 }} />}
          {chat.unread > 0 && (
            <View
              style={{
                backgroundColor: chat.muted ? t.subtext : t.accent, minWidth: 20, height: 20, borderRadius: 10,
                alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 8,
              }}
            >
              <Text style={{ color: t.onAccent, fontSize: 12, fontWeight: '700' }}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default React.memo(ChatRowBase);
