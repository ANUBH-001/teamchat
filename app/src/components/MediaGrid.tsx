// Round 4 Phase 3: grid of the photos of one chat (from loaded / fetched messages). Tap = full-screen viewer.
import React, { useState } from 'react';
import { Dimensions, FlatList, Modal, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { Msg } from '../chatTypes';
import { mediaCacheKey, useMediaSrc } from '../media';
import ImageViewer from './ImageViewer';

export const imagesOf = (msgs: Msg[]) => msgs.filter((m) => m.type === 'image' && !m.deleted && !!m.mediaUrl).sort((a, b) => (b.id || 0) - (a.id || 0));

function Thumb({ m, size, onPress }: { m: Msg; size: number; onPress: (m: Msg) => void }) {
  const t = useTheme();
  const src = useMediaSrc(m.mediaUrl || null);
  return (
    <Pressable onPress={() => onPress(m)} style={{ width: size, height: size, padding: 1 }}>
      <View style={{ flex: 1, backgroundColor: t.surface }}>{!!src && <Image source={{ uri: src, cacheKey: mediaCacheKey(m.mediaUrl) }} style={{ flex: 1 }} contentFit="cover" />}</View>
    </Pressable>
  );
}

// Horizontal-free small grid (first `limit` photos) for the chat info page.
export function MediaPreview({ msgs, limit = 8, onSeeAll }: { msgs: Msg[]; limit?: number; onSeeAll: () => void }) {
  const t = useTheme();
  const [view, setView] = useState<Msg | null>(null);
  const list = imagesOf(msgs);
  if (!list.length) return null;
  const size = (Dimensions.get('window').width - 32) / 4;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <Pressable onPress={onSeeAll} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
        <Text style={{ flex: 1, color: t.subtext, fontSize: 13, fontWeight: '700' }}>Media ({list.length})</Text>
        <Text style={{ color: t.accent, fontSize: 13, fontWeight: '700' }}>See all</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {list.slice(0, limit).map((m) => <Thumb key={m.id} m={m} size={size} onPress={setView} />)}
      </View>
      <ImageViewer visible={!!view} url={view?.mediaUrl || null} caption={view?.text} title={view?.senderName} onClose={() => setView(null)} />
    </View>
  );
}

export function MediaGridModal({ visible, onClose, msgs, title = 'Media' }: { visible: boolean; onClose: () => void; msgs: Msg[]; title?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<Msg | null>(null);
  const size = Dimensions.get('window').width / 3;
  const list = imagesOf(msgs);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.background }}>
        <View style={{ backgroundColor: t.header, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 44, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={24} color={t.onAccent} />
          </Pressable>
          <Text style={{ color: t.onAccent, fontSize: 19, fontWeight: '600', marginLeft: 6 }}>{title}</Text>
        </View>
        <FlatList
          data={list} numColumns={3} keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => <Thumb m={item} size={size} onPress={setView} />}
          ListEmptyComponent={<Text style={{ color: t.subtext, textAlign: 'center', padding: 40 }}>Is chat me abhi koi photo nahi (jitne messages load hue unme)</Text>}
          contentContainerStyle={{ paddingBottom: insets.bottom }}
        />
        <ImageViewer visible={!!view} url={view?.mediaUrl || null} caption={view?.text} title={view?.senderName} onClose={() => setView(null)} />
      </View>
    </Modal>
  );
}
