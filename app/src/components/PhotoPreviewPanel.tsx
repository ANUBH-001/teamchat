// Round 4 Phase 3: preview + caption before sending one or several photos (gallery / camera / geo camera).
// Plain View (no Modal): the caller wraps it in a Modal (ChatScreen) or shows it inside the geo camera modal.
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';

export type PreviewItem = { uri: string; caption: string };

export default function PhotoPreviewPanel({ uris, onSend, onCancel, sending, cancelLabel }: {
  uris: string[]; onSend: (items: PreviewItem[]) => void; onCancel: () => void; sending?: boolean; cancelLabel?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [caps, setCaps] = useState<string[]>(() => uris.map(() => ''));
  const i = Math.min(idx, uris.length - 1);
  const setCap = (v: string) => setCaps((c) => c.map((x, k) => (k === i ? v : x)));
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'padding' : 'padding'} style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onCancel} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={cancelLabel || 'Cancel'}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {uris.length > 1 && <Text style={{ color: '#fff', fontSize: 15, marginLeft: 8 }}>{i + 1} / {uris.length}</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Image source={{ uri: uris[i] }} style={{ flex: 1 }} contentFit="contain" />
      </View>
      {uris.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, paddingVertical: 6 }} contentContainerStyle={{ paddingHorizontal: 8 }}>
          {uris.map((u, k) => (
            <Pressable key={u + k} onPress={() => setIdx(k)} style={{ marginRight: 6, borderWidth: 2, borderColor: k === i ? t.accent : 'transparent', borderRadius: 6 }}>
              <Image source={{ uri: u }} style={{ width: 52, height: 52, borderRadius: 4 }} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: 8 + insets.bottom }}>
        <TextInput
          value={caps[i] || ''} onChangeText={setCap} placeholder="Write a caption..." placeholderTextColor={t.subtext} multiline
          style={{ flex: 1, maxHeight: 100, backgroundColor: t.card, color: t.text, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 }}
        />
        <Pressable
          onPress={() => onSend(uris.map((u, k) => ({ uri: u, caption: (caps[k] || '').trim() })))} disabled={sending}
          style={{ width: 48, height: 48, borderRadius: 24, marginLeft: 8, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: sending ? 0.6 : 1 }}
          accessibilityLabel="Send"
        >
          {sending ? <ActivityIndicator color={t.onAccent} /> : <Ionicons name="send" size={22} color={t.onAccent} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
