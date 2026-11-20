// Round 4 Phase 3: WhatsApp-style voice note recorder (expo-av). Hold mic = record, slide left = cancel, slide up = lock.
// useVoiceRecorder = recording state machine; useMicGesture = press-and-hold gesture; RecordingBar / LockedBar = the UI.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';

export type VoiceResult = { uri: string; durationMs: number; waveform: number[] };
export type RecState = 'idle' | 'rec' | 'locked';

const HQ = Audio.RecordingOptionsPresets.HIGH_QUALITY;
// m4a AAC mono 64 kbps, metering on (live waveform + stored peaks)
const OPTIONS: Audio.RecordingOptions = {
  ...HQ,
  isMeteringEnabled: true,
  android: { ...HQ.android, extension: '.m4a', outputFormat: Audio.AndroidOutputFormat.MPEG_4, audioEncoder: Audio.AndroidAudioEncoder.AAC, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000 },
  ios: { ...HQ.ios, sampleRate: 22050, numberOfChannels: 1, bitRate: 64000 },
};

export const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

// ~48 normalized peaks 0..1 from the raw 100 ms samples
export function peaks(samples: number[], n = 48): number[] {
  if (!samples.length) return Array(n).fill(0.1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * samples.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * samples.length) / n));
    out.push(Math.max(...samples.slice(a, b)));
  }
  const top = Math.max(...out, 0.2);
  return out.map((v) => Math.round(Math.max(0.08, Math.min(1, v / top)) * 100) / 100);
}

export function useVoiceRecorder(cb: { onDone: (r: VoiceResult) => void; onShort: () => void; onError: (m: string) => void }) {
  const [state, setState] = useState<RecState>('idle');
  const [paused, setPaused] = useState(false);
  const [ms, setMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const rec = useRef<Audio.Recording | null>(null);
  const samples = useRef<number[]>([]);
  const dur = useRef(0);
  const stateRef = useRef<RecState>('idle');
  const wantStop = useRef<null | 'send' | 'cancel'>(null); // released while the recorder was still starting
  const setSt = (s: RecState) => { stateRef.current = s; setState(s); };

  const onStatus = (st: Audio.RecordingStatus) => {
    if (!st.isRecording) return;
    dur.current = st.durationMillis;
    const lv = typeof st.metering === 'number' ? Math.max(0, Math.min(1, (st.metering + 50) / 50)) : 0.3;
    samples.current.push(lv);
    setMs(st.durationMillis);
    setLevels(samples.current.slice(-40));
  };

  const finish = useCallback(async (send: boolean) => {
    if (stateRef.current === 'idle') return;
    const r = rec.current;
    if (!r) { wantStop.current = send ? 'send' : 'cancel'; return; }
    rec.current = null;
    setSt('idle');
    setPaused(false);
    try {
      let durationMs = dur.current;
      try { durationMs = (await r.getStatusAsync()).durationMillis || durationMs; } catch (e) {}
      await r.stopAndUnloadAsync();
      const uri = r.getURI();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      if (!send || !uri) return;
      if (durationMs < 1000) { cbRef.current.onShort(); return; }
      cbRef.current.onDone({ uri, durationMs, waveform: peaks(samples.current, 48) });
    } catch (e: any) {
      cbRef.current.onError('Recording nahi hui');
    }
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    wantStop.current = null;
    samples.current = [];
    dur.current = 0;
    setMs(0); setLevels([]); setPaused(false);
    setSt('rec');
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) throw new Error('Mic ki permission do (Settings)');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(OPTIONS, onStatus, 100);
      rec.current = recording;
    } catch (e: any) {
      rec.current = null;
      setSt('idle');
      cbRef.current.onError(e?.message || 'Mic start nahi hua');
      return;
    }
    if (wantStop.current) finish(wantStop.current === 'send'); // finger already lifted
  }, [finish]);

  const lock = useCallback(() => { if (stateRef.current === 'rec') setSt('locked'); }, []);
  const togglePause = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    try {
      if (paused) { await r.startAsync(); setPaused(false); } else { await r.pauseAsync(); setPaused(true); }
    } catch (e) {}
  }, [paused]);

  useEffect(() => () => {
    const r = rec.current;
    rec.current = null;
    if (r) r.stopAndUnloadAsync().catch(() => {});
  }, []);

  return { state, stateRef, paused, ms, levels, start, lock, togglePause, send: () => finish(true), cancel: () => finish(false) };
}

export type Recorder = ReturnType<typeof useVoiceRecorder>;

// Press-and-hold on the mic: slide left > 100 = cancel, slide up > 80 = lock, release (unlocked) = send.
export function useMicGesture(r: Recorder, enabled: boolean) {
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const rr = useRef(r);
  rr.current = r;
  const on = useRef(enabled);
  on.current = enabled;
  const ended = useRef(false);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => on.current,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { ended.current = false; dragX.setValue(0); dragY.setValue(0); rr.current.start(); },
    onPanResponderMove: (_, g) => {
      if (ended.current || rr.current.stateRef.current !== 'rec') return;
      dragX.setValue(Math.min(0, g.dx));
      dragY.setValue(Math.min(0, g.dy));
      // Round 4: reset the drag offset right away - after lock/cancel the mic can unmount and never see the release, leaving it floating
      if (g.dx < -100) { ended.current = true; dragX.setValue(0); dragY.setValue(0); rr.current.cancel(); }
      else if (g.dy < -80) { ended.current = true; dragX.setValue(0); dragY.setValue(0); rr.current.lock(); }
    },
    onPanResponderRelease: () => {
      dragX.setValue(0); dragY.setValue(0);
      if (!ended.current && rr.current.stateRef.current === 'rec') rr.current.send();
      ended.current = true;
    },
    onPanResponderTerminate: () => {
      dragX.setValue(0); dragY.setValue(0);
      if (!ended.current) rr.current.cancel();
      ended.current = true;
    },
  }), [dragX, dragY]);
  return { panHandlers: pan.panHandlers, dragX, dragY };
}

// Live bars (last N samples), newest on the right.
export function LiveWave({ levels, color, height = 30, bars = 30 }: { levels: number[]; color: string; height?: number; bars?: number }) {
  const shown = levels.slice(-bars);
  const pad = Array(Math.max(0, bars - shown.length)).fill(0.06);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height, overflow: 'hidden', flex: 1 }}>
      {[...pad, ...shown].map((v, i) => (
        <View key={i} style={{ width: 3, marginRight: 2, borderRadius: 2, height: Math.max(3, v * height), backgroundColor: color }} />
      ))}
    </View>
  );
}

// Unlocked recording: red dot + timer + "< Slide to cancel" (follows the finger).
export function RecordingBar({ t, ms, levels, dragX }: { t: Theme; ms: number; levels: number[]; dragX: Animated.Value }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => { const i = setInterval(() => setBlink((b) => !b), 600); return () => clearInterval(i); }, []);
  const fade = dragX.interpolate({ inputRange: [-100, 0], outputRange: [0.2, 1], extrapolate: 'clamp' });
  return (
    <View style={{ flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 24, paddingHorizontal: 14 }}>
      <Ionicons name="mic" size={20} color={t.danger} style={{ opacity: blink ? 1 : 0.25 }} />
      <Text style={{ color: t.text, fontSize: 16, marginLeft: 8, minWidth: 40 }}>{fmtMs(ms)}</Text>
      <View style={{ width: 60, marginRight: 6 }}><LiveWave levels={levels} color={t.accent} bars={12} height={22} /></View>
      <Animated.View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', opacity: fade, transform: [{ translateX: Animated.multiply(dragX, 0.4) }] }}>
        <Ionicons name="chevron-back" size={16} color={t.subtext} />
        <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 14 }}>Slide to cancel</Text>
      </Animated.View>
    </View>
  );
}

// Small lock hint above the mic while holding (slide up to lock).
export function LockHint({ t, dragY }: { t: Theme; dragY: Animated.Value }) {
  const up = dragY.interpolate({ inputRange: [-80, 0], outputRange: [-30, 0], extrapolate: 'clamp' });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', right: 8, bottom: 70, width: 40, height: 76, borderRadius: 20, backgroundColor: t.card, alignItems: 'center', justifyContent: 'space-around', elevation: 4, transform: [{ translateY: up }] }}
    >
      <Ionicons name="lock-closed" size={18} color={t.accent} />
      <Ionicons name="chevron-up" size={18} color={t.subtext} />
    </Animated.View>
  );
}

// Locked (hands-free): delete, timer, waveform, pause / resume, send.
export function LockedBar({ t, r }: { t: Theme; r: Recorder }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 28, paddingHorizontal: 6, minHeight: 56 }}>
      <Pressable onPress={r.cancel} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Delete recording">
        <Ionicons name="trash-outline" size={24} color={t.danger} />
      </Pressable>
      <Text style={{ color: t.text, fontSize: 15, minWidth: 40 }}>{fmtMs(r.ms)}</Text>
      <View style={{ flex: 1, marginHorizontal: 8 }}>
        <LiveWave levels={r.levels} color={r.paused ? t.subtext : t.accent} bars={22} />
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
