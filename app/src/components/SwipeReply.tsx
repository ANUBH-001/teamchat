import React, { useRef } from 'react';
import { Animated, PanResponder, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const TRIGGER = 56; // px of swipe that counts as "reply"
const MAX = 80;

// WhatsApp-style swipe right to reply. Plain PanResponder + Animated (no native module, no rebuild needed).
export default function SwipeReply({
  enabled, onReply, color, children,
}: { enabled: boolean; onReply: () => void; color: string; children: React.ReactNode }) {
  const x = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  const enabledRef = useRef(enabled);
  const replyRef = useRef(onReply);
  enabledRef.current = enabled;
  replyRef.current = onReply;

  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        enabledRef.current && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => {
        const dx = Math.max(0, Math.min(g.dx, MAX));
        x.setValue(dx);
        if (dx >= TRIGGER && !fired.current) { fired.current = true; Vibration.vibrate(12); }
      },
      onPanResponderRelease: () => {
        const go = fired.current;
        fired.current = false;
        back();
        if (go) replyRef.current();
      },
      onPanResponderTerminate: () => { fired.current = false; back(); },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  return (
    <View {...pan.panHandlers}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 12, top: 0, bottom: 0, justifyContent: 'center',
          opacity: x.interpolate({ inputRange: [0, TRIGGER], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ scale: x.interpolate({ inputRange: [0, TRIGGER], outputRange: [0.5, 1], extrapolate: 'clamp' }) }],
        }}
      >
        <Ionicons name="arrow-undo" size={22} color={color} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }}>{children}</Animated.View>
    </View>
  );
}
