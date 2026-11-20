// WhatsApp-style voice note recorder (expo-av). Hold mic = record, slide left = cancel, slide up = lock, release = send.
// The state machine lives in ../recorderEngine.ts (hardening R-05 / R-02); this file is the React glue + UI:
// useVoiceRecorder = engine hook (AppState background = discard, unmount = dispose); useMicGesture = press-and-hold gesture;
// RecordingBar / LockedBar / LockHint = the UI.
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, AppState, PanResponder, Pressable, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { EngineCallbacks, Phase, RecorderEngine, VoiceResult } from '../recorderEngine';

export type { VoiceResult } from '../recorderEngine';
export { peaks } from '../recorderEngine';
export type RecState = Phase;

export const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
// live timer: whole seconds elapsed (0:00 for the first second, like every recorder)
const fmtLive = (ms: number) => fmtMs(Math.floor(ms / 1000) * 1000);

const deleteFile = (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true });

export function useVoiceRecorder(cb: { onDone: (r: VoiceResult) => void; onShort: () => void; onError: (m: string) => void; onNotice?: (m: string) => void }) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const [engine, setEngine] = useState(() => newEngine(cbRef));
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  useEffect(() => {
    let e = engine;
    if (e.isDead) { e = newEngine(cbRef); setEngine(e); return; } // (dev StrictMode re-mount)
    e.prepare(); // permission status + audio mode now, so a press is one native call
    const sub = AppState.addEventListener('change', (s) => { if (s === 'background') e.background(); });
    return () => { sub.remove(); e.destroy(); };
  }, [engine]);
  return useMemo(() => ({
    state: snap.phase,
    phase: () => engine.phase, // current value for gesture handlers (no stale closure)
    paused: snap.paused,
    ms: snap.ms,
    levels: snap.levels,
    leftMs: snap.leftMs,
    start: () => { engine.start(); },
    lock: () => engine.lock(),
    togglePause: () => { engine.togglePause(); },
    send: () => { engine.send(); },
    cancel: () => { engine.cancel(); },
  }), [engine, snap]);
}

function newEngine(cbRef: React.MutableRefObject<Parameters<typeof useVoiceRecorder>[0]>) {
  const cbs: EngineCallbacks = {
    onDone: (r) => cbRef.current.onDone(r),
    onShort: () => cbRef.current.onShort(),
    onError: (m) => cbRef.current.onError(m),
    onNotice: (m) => (cbRef.current.onNotice || cbRef.current.onError)(m),
  };
  return new RecorderEngine(cbs, { deleteFile });
}

export type Recorder = ReturnType<typeof useVoiceRecorder>;

export const CANCEL_DX = 90; // slide left this far = cancel
export const LOCK_DY = 70; // slide up this far = lock

// Press-and-hold on the mic. Works while the engine is still starting (slide / release = immediate cancel there);
// lock needs a running recorder, so an early slide-up locks as soon as the mic is live.
export function useMicGesture(r: Recorder, enabled: boolean) {
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const rr = useRef(r);
  rr.current = r;
  const on = useRef(enabled);
  on.current = enabled;
  const ended = useRef(true);
  const pan = useMemo(() => {
    const reset = () => { dragX.setValue(0); dragY.setValue(0); };
    const live = () => { const p = rr.current.phase(); return p === 'rec' || p === 'starting'; };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => on.current,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { ended.current = false; reset(); rr.current.start(); },
      onPanResponderMove: (_, g) => {
        if (ended.current || !live()) return;
        const sideways = Math.abs(g.dx) >= Math.abs(g.dy);
        dragX.setValue(sideways ? Math.min(0, g.dx) : 0);
        dragY.setValue(sideways ? 0 : Math.min(0, g.dy));
        // reset the offset right away: after lock/cancel the mic may never see the release
        if (g.dx < -CANCEL_DX) { ended.current = true; reset(); rr.current.cancel(); }
        else if (g.dy < -LOCK_DY && rr.current.phase() === 'rec') { ended.current = true; reset(); rr.current.lock(); }
      },
      onPanResponderRelease: () => {
        reset();
        if (!ended.current && live()) rr.current.send(); // still starting -> engine discards with the "too short" toast
        ended.current = true;
      },
      onPanResponderTerminate: () => {
        reset();
        if (!ended.current && live()) rr.current.cancel();
        ended.current = true;
      },
    });
  }, [dragX, dragY]);
  return { panHandlers: pan.panHandlers, dragX, dragY };
}

// Live bars, newest on the right; as many bars as fit the width.
export function LiveWave({ levels, color, height = 26 }: { levels: number[]; color: string; height?: number }) {
  const [bars, setBars] = useState(24);
  const shown = levels.slice(-bars);
  const pad = Array(Math.max(0, bars - shown.length)).fill(0.06);
  return (
    <View
      onLayout={(e) => setBars(Math.max(8, Math.floor(e.nativeEvent.layout.width / 5)))}
      style={{ flexDirection: 'row', alignItems: 'center', height, overflow: 'hidden', flex: 1 }}
    >
      {[...pad, ...shown].map((v, i) => (
        <View key={i} style={{ width: 3, marginRight: 2, borderRadius: 2, height: Math.max(3, v * height), backgroundColor: color }} />
      ))}
    </View>
  );
}

const leftText = (leftMs: number | null) => (leftMs == null ? null : fmtMs(leftMs) + ' baaki, phir apne aap jayega');

// Unlocked recording: red dot + timer + live waveform, "< Slide to cancel" under it (follows the finger).
export function RecordingBar({ t, ms, levels, dragX, starting, leftMs }: {
  t: Theme; ms: number; levels: number[]; dragX: Animated.Value; starting?: boolean; leftMs?: number | null;
}) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { const i = setInterval(() => setBlink((b) => !b), 600); return () => clearInterval(i); }, []);
  const fade = dragX.interpolate({ inputRange: [-CANCEL_DX, 0], outputRange: [0.2, 1], extrapolate: 'clamp' });
  const hint = leftText(leftMs ?? null);
  return (
    <View style={{ flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 24, paddingHorizontal: 12 }}>
      <Ionicons name="mic" size={20} color={starting ? t.subtext : t.danger} style={{ opacity: blink || starting ? 1 : 0.25 }} />
      <Text style={{ color: t.text, fontSize: 16, marginLeft: 6, minWidth: 40, fontVariant: ['tabular-nums'] }}>{fmtLive(ms)}</Text>
      <View style={{ flex: 1, marginLeft: 4 }}>
        {starting ? (
          <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13 }}>Mic shuru ho raha hai…</Text>
        ) : (
          <LiveWave levels={levels} color={t.accent} height={20} />
        )}
        <Animated.View style={{ flexDirection: 'row', alignItems: 'center', opacity: fade, transform: [{ translateX: Animated.multiply(dragX, 0.4) }] }}>
          <Ionicons name="chevron-back" size={12} color={hint ? t.danger : t.subtext} />
          <Text numberOfLines={1} style={{ color: hint ? t.danger : t.subtext, fontSize: 12 }}>{hint || 'Slide to cancel'}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

// Small lock hint above the mic while holding (slide up to lock). `right` = distance of the mic's center minus 20 from the edge.
export function LockHint({ t, dragY, right = 8 }: { t: Theme; dragY: Animated.Value; right?: number }) {
  const up = dragY.interpolate({ inputRange: [-LOCK_DY, 0], outputRange: [-30, 0], extrapolate: 'clamp' });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', right, bottom: 70, width: 40, height: 76, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'space-around', elevation: 4, transform: [{ translateY: up }] }}
    >
      <Ionicons name="lock-closed" size={18} color={t.accent} />
      <Ionicons name="chevron-up" size={18} color={t.subtext} />
    </Animated.View>
  );
}

// Locked (hands-free): delete, timer, waveform, pause / resume, send.
export function LockedBar({ t, r }: { t: Theme; r: Recorder }) {
  const hint = leftText(r.leftMs);
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 28, paddingHorizontal: 6, minHeight: 56 }}>
      <Pressable onPress={r.cancel} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Delete recording">
        <Ionicons name="trash-outline" size={24} color={t.danger} />
      </Pressable>
      <Text style={{ color: t.text, fontSize: 15, minWidth: 40, fontVariant: ['tabular-nums'] }}>{fmtLive(r.ms)}</Text>
      <View style={{ flex: 1, marginHorizontal: 8 }}>
        <LiveWave levels={r.levels} color={r.paused ? t.subtext : t.accent} />
        {!!hint && <Text numberOfLines={1} style={{ color: t.danger, fontSize: 11 }}>{hint}</Text>}
      </View>
      <Pressable onPress={r.togglePause} hitSlop={6} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={r.paused ? 'Resume' : 'Pause'}>
        <Ionicons name={r.paused ? 'mic' : 'pause'} size={24} color={t.danger} />
      </Pressable>
      <Pressable onPress={r.send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Send voice note">
        <Ionicons name="send" size={20} color={t.onAccent} />
      </Pressable>
    </View>
  );
}
