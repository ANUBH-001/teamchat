// Round 4 Phase 3: Starred messages (local list from starStore). Tap = open that chat scrolled to the message.
import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { toggleStar, useStars } from '../starStore';

export default function StarredScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (chatId: number, messageId: number) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const stars = useStars();
  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ color: t.onAccent, fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: t.onAccent, fontSize: 19, fontWeight: '600', marginLeft: 6 }}>Starred messages</Text>
      </View>
      <FlatList
        data={stars}
        keyExtractor={(s) => s.chatId + ':' + s.messageId}
        ListEmptyComponent={<Text style={{ color: t.subtext, textAlign: 'center', padding: 40 }}>No starred messages. Long-press a message to star it.</Text>}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.chatId, item.messageId)} android_ripple={{ color: t.border }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.border }}
          >
            <Ionicons name="star" size={18} color={t.accent} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text numberOfLines={1} style={{ color: t.accent, fontSize: 12, fontWeight: '700' }}>
                {[item.senderName, item.chatName].filter(Boolean).join(' · ') || 'Chat'}
              </Text>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 15 }}>{item.preview}</Text>
              <Text style={{ color: t.subtext, fontSize: 11, marginTop: 2 }}>{new Date(item.ts).toLocaleDateString()}</Text>
            </View>
            <Pressable onPress={() => toggleStar(item)} hitSlop={10} style={{ padding: 8 }}>
              <Ionicons name="close" size={20} color={t.subtext} />
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}
