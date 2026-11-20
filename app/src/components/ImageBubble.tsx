// Round 4 Phase 3: image / geo-photo content of a chat bubble (rounded, aspect from media.w/h, max 240 wide).
import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Msg } from '../chatTypes';
import { mediaCacheKey, useMediaSrc } from '../media';

export const IMG_W = 240;

export default function ImageBubble({ msg, onOpen, onLongPress, textColor, linkColor, children }: {
  msg: Msg; onOpen: (m: Msg) => void; onLongPress: (m: Msg) => void; textColor: string; linkColor: string;
  children?: React.ReactNode; // overlay (time / ticks) on the photo
}) {
  const src = useMediaSrc(msg.mediaUrl || null);
  const m = msg.media;
  const w = m?.w || 4;
  const h = m?.h || 3;
  const height = Math.round(IMG_W * Math.max(0.5, Math.min(1.6, h / w)));
  const geo = !!m && m.kind === 'geo_image' && m.lat != null && m.lng != null;
  return (
    <View>
      <Pressable onPress={() => onOpen(msg)} onLongPress={() => onLongPress(msg)} style={{ width: IMG_W, height, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.15)' }}>
        {!!src && <Image source={{ uri: src, cacheKey: mediaCacheKey(msg.mediaUrl) }} style={{ width: IMG_W, height }} contentFit="cover" transition={150} />}
        {children}
      </Pressable>
      {geo && (
        <View style={{ width: IMG_W, paddingTop: 4 }}>
          {!!m!.address && <Text numberOfLines={2} style={{ fontSize: 12, color: textColor }}>{'📍 ' + m!.address}</Text>}
          <Pressable
            onPress={() => Linking.openURL('geo:' + m!.lat + ',' + m!.lng + '?q=' + m!.lat + ',' + m!.lng).catch(() => {})}
            hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}
          >
            <Ionicons name="map-outline" size={13} color={linkColor} />
            <Text style={{ color: linkColor, fontSize: 12, fontWeight: '700', marginLeft: 4, textDecorationLine: 'underline' }}>Open in Maps</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
