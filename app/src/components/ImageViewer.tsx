// Round 4 Phase 3: full-screen image viewer. Pinch zoom (two touches via PanResponder), pan when zoomed, double tap zoom,
// Save to gallery (album TeamChat). Share is skipped: expo-sharing is not installed.
import React, { useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Modal, PanResponder, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaSrc, saveToGallery, useMediaSrc } from '../media';

const MAX_SCALE = 5;
const dist = (t: any[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

export default function ImageViewer({ visible, url, caption, title, onClose }: {
  visible: boolean; url: string | null; caption?: string | null; title?: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const src = useMediaSrc(url);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const wasPinch = useRef(false);
  const lastTap = useRef(0);

  const apply = () => { scale.setValue(cur.current.s); tx.setValue(cur.current.x); ty.setValue(cur.current.y); };
  const reset = () => { cur.current = { s: 1, x: 0, y: 0 }; apply(); };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { origin.current = { x: cur.current.x, y: cur.current.y }; pinch.current = null; wasPinch.current = false; },
    onPanResponderMove: (e, g) => {
      const touches = e.nativeEvent.touches as any[];
      if (touches.length >= 2) {
        const d = dist(touches);
        if (!pinch.current) pinch.current = { d, s: cur.current.s };
        cur.current.s = Math.max(1, Math.min(MAX_SCALE, (pinch.current.s * d) / pinch.current.d));
        wasPinch.current = true;
        apply();
      } else if (cur.current.s > 1) {
        if (pinch.current) { origin.current = { x: cur.current.x - g.dx, y: cur.current.y - g.dy }; pinch.current = null; }
        const lim = ((cur.current.s - 1) * Dimensions.get('window').width) / 2;
        cur.current.x = Math.max(-lim, Math.min(lim, origin.current.x + g.dx));
        cur.current.y = origin.current.y + g.dy;
        apply();
      }
    },
    onPanResponderRelease: (_, g) => {
      pinch.current = null;
      if (cur.current.s < 1.05) reset();
      if (Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8 && !wasPinch.current) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          if (cur.current.s > 1) reset(); else { cur.current = { s: 2.5, x: 0, y: 0 }; apply(); }
          lastTap.current = 0;
        } else lastTap.current = now;
      }
    },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { reset(); setNote(''); onClose(); };
  const save = async () => {
    const full = mediaSrc(url);
    if (!full || saving) return;
    setSaving(true);
    try {
      const f = await FileSystem.downloadAsync(full, (FileSystem.cacheDirectory || '') + 'tc_' + Date.now() + '.jpg');
      setNote((await saveToGallery(f.uri)) ? 'Gallery me save ho gaya' : 'Save nahi hua (permission?)');
    } catch (e) { setNote('Save nahi hua'); }
    setSaving(false);
  };

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View {...pan.panHandlers} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {!!src && (
            <Animated.View style={{ width: '100%', height: '100%', transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
              <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
            </Animated.View>
          )}
        </View>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingBottom: 8, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable onPress={close} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-back" size={26} color="#fff" />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, color: '#fff', fontSize: 16, marginLeft: 6 }}>{title || ''}</Text>
          <Pressable onPress={save} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Save to gallery">
            <Ionicons name={saving ? 'hourglass-outline' : 'download-outline'} size={24} color="#fff" />
          </Pressable>
        </View>
        {(!!caption || !!note) && (
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 12, paddingTop: 10, paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            {!!note && <Text style={{ color: '#fff', fontSize: 13, opacity: 0.8, marginBottom: 2 }}>{note}</Text>}
            {!!caption && <Text style={{ color: '#fff', fontSize: 15 }}>{caption}</Text>}
          </View>
        )}
      </View>
    </Modal>
  );
}
