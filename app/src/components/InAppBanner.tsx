import React, { useEffect, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { emitEvent } from '../realtime';
import { getBanner, hasRootHost, hideBanner, registerRootHost, subscribeBanner, subscribeHosts } from '../bannerStore';

// Top banner while the app is open: "X ne status poocha" / "X mentioned you" in a chat that is not on screen.
// Tap = open that chat (ChatsScreen handles '_open_chat'). Mount once with `root` in App.tsx for every screen;
// ChatScreen mounts a local one that hides itself when a root host exists.
export default function InAppBanner({ root }: { root?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const b = useSyncExternalStore(subscribeBanner, getBanner);
  const rootThere = useSyncExternalStore(subscribeHosts, hasRootHost);
  useEffect(() => (root ? registerRootHost() : undefined), [root]);
  if (!b || (!root && rootThere)) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 6, left: 8, right: 8, zIndex: 50, elevation: 12 }}>
      <Pressable
        onPress={() => { hideBanner(); emitEvent({ type: '_open_chat', chatId: b.chatId, messageId: b.messageId ?? null }); }}
        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: t.border, elevation: 12 }}
      >
        <Ionicons name="notifications" size={20} color={t.accent} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{b.title}</Text>
          {!!b.body && <Text numberOfLines={2} style={{ color: t.subtext, fontSize: 13 }}>{b.body}</Text>}
        </View>
        <Pressable onPress={hideBanner} hitSlop={10} style={{ padding: 4 }}>
          <Ionicons name="close" size={18} color={t.subtext} />
        </Pressable>
      </Pressable>
    </View>
  );
}
