// Round 4 Phase 3: voice note bubble (WhatsApp style): sender avatar, play / pause, waveform as seek bar, elapsed / duration,
// speed chip 1x / 1.5x / 2x, transcript under it. Only one voice plays at a time (module-level `current`).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { Msg } from '../chatTypes';
import { signedMediaUrl, useMediaSrc } from '../media';
import { usePrefs } from '../prefs';
import Avatar from './Avatar';
import { fmtMs } from './VoiceRecorder';
import { deleteVoice, sendQueuedVoice, useVoiceState } from '../voiceOutbox';
import { PENDING_STUCK_MS, requestTranscript, transcriptView } from '../transcriptRetry';
import { useAuth } from '../auth';
import { toast } from '../useVoiceInput';

let current: { key: string; stop: () => Promise<void> } | null = null;
const SPEEDS = [1, 1.5, 2];
const BARS = 32;

function resample(w: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const a = Math.floor((i * w.length) / BARS);
    const b = Math.max(a + 1, Math.floor(((i + 1) * w.length) / BARS));
    out.push(Math.max(...w.slice(a, b)));
  }
  return out;
}

export default function VoiceBubble({ msg, mine, t }: { msg: Msg; mine: boolean; t: Theme }) {
  const url = useMediaSrc(msg.mediaUrl || null);
  const prefs = usePrefs();
  const key = String(msg.id || msg.clientId);
  const wave = useMemo(() => resample(msg.media?.waveform?.length ? msg.media.waveform : Array(BARS).fill(0.35)), [msg.media?.waveform]);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [realDur, setRealDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [open, setOpen] = useState<boolean | null>(null);
  const sound = useRef<Audio.Sound | null>(null);
  const speedRef = useRef(1);
  speedRef.current = speed;
  const dur = msg.media?.durationMs || realDur || 0;
  const durRef = useRef(dur);
  durRef.current = dur;
  const width = useRef(1);

  const unload = async () => {
    const s = sound.current;
    sound.current = null;
    if (current && current.key === key) current = null;
    setPlaying(false);
    if (s) { try { await s.unloadAsync(); } catch (e) {} }
  };
  useEffect(() => () => { unload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onStatus = (st: AVPlaybackStatus) => {
    if (!st.isLoaded) return;
    setPos(st.positionMillis);
    setPlaying(st.isPlaying);
    if (st.durationMillis) setRealDur(st.durationMillis);
    if (st.didJustFinish) { unload(); setPos(0); }
  };

  const play = async (from = 0) => {
    if (!url) return;
    try {
      const fresh = (await signedMediaUrl(msg.mediaUrl || null)) || url; // the screen may have been open past the URL's expiry
      if (current && current.key !== key) await current.stop();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: fresh },
        { shouldPlay: true, positionMillis: from, rate: speedRef.current, shouldCorrectPitch: true, progressUpdateIntervalMillis: 120 },
        onStatus,
      );
      sound.current = s;
      current = { key, stop: async () => { await unload(); setPos(0); } };
    } catch (e) { setPlaying(false); }
  };

  const toggle = async () => {
    const s = sound.current;
    if (!s) { play(pos >= durRef.current ? 0 : pos); return; }
    try {
      const st = await s.getStatusAsync();
      if (!st.isLoaded) return;
      if (st.isPlaying) await s.pauseAsync(); else await s.playAsync();
    } catch (e) {}
  };

  const seek = (frac: number) => {
    const ms = Math.max(0, Math.min(1, frac)) * durRef.current;
    setPos(ms);
    if (sound.current) sound.current.setPositionAsync(ms).catch(() => {});
  };
  const seekPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => seek(e.nativeEvent.locationX / width.current),
    onPanResponderMove: (e) => seek(e.nativeEvent.locationX / width.current),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const cycleSpeed = () => {
    const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(n);
    if (sound.current) sound.current.setRateAsync(n, true).catch(() => {});
  };

  const frac = dur ? Math.min(1, pos / dur) : 0;
  const done = mine ? t.onAccent : t.accent;
  const todo = mine ? 'rgba(255,255,255,0.45)' : t.border;
  const main = mine ? t.bubbleOutText : t.text;
  const sub = mine ? 'rgba(255,255,255,0.75)' : t.subtext;
  const m = msg.media;
  const tr = m?.transcript;
  const expanded = open ?? prefs.autoTranscripts;
  // A-12: my unsent voice note (voiceOutbox): sending / failed with Retry + Delete
  const outbox = useVoiceState(msg.id ? null : msg.clientId);
  // V-04: transcript failed / stuck -> reason + "Dobara try karo" (sender or boss)
  const { user } = useAuth();
  const [, rerender] = useState(0);
  const tv = transcriptView(msg, { meId: user?.id ?? -1, isBoss: user?.role === 'boss', now: Date.now() });
  const stuckAt = m?.transcriptStatus === 'pending' && !tr ? Date.parse(msg.createdAt) + PENDING_STUCK_MS : 0;
  useEffect(() => { // re-check when a pending transcript turns "stuck"
    const wait = stuckAt - Date.now();
    if (!stuckAt || wait <= 0) return;
    const id = setTimeout(() => rerender((n) => n + 1), wait + 500);
    return () => clearTimeout(id);
  }, [stuckAt]);
  const retryTranscript = async () => {
    rerender((n) => n + 1);
    const r = await requestTranscript(msg);
    if (r === 'error') toast('Transcript nahi maanga ja saka, baad mein try karo');
    rerender((n) => n + 1);
  };

  return (
    <View style={{ width: 250 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar name={msg.senderName} id={msg.senderId} userId={msg.senderId} size={36} />
        <Pressable onPress={toggle} hitSlop={6} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }} accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <Ionicons name={playing ? 'pause' : 'play'} size={28} color={main} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View
            {...seekPan.panHandlers}
            onLayout={(e) => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
            style={{ height: 30, justifyContent: 'center' }}
          >
            <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', height: 30 }}>
              {wave.map((v, i) => (
                <View key={i} style={{ flex: 1, marginHorizontal: 0.7, borderRadius: 2, height: Math.max(3, v * 26), backgroundColor: i / BARS < frac ? done : todo }} />
              ))}
            </View>
          </View>
          <Text style={{ color: sub, fontSize: 11 }}>{playing || pos > 0 ? fmtMs(pos) + ' / ' + fmtMs(dur) : fmtMs(dur)}</Text>
        </View>
        <Pressable onPress={cycleSpeed} hitSlop={6} style={{ marginLeft: 6, minWidth: 38, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' }}>
          <Text style={{ color: main, fontSize: 12, fontWeight: '700' }}>{speed === 1 ? '1x' : speed + 'x'}</Text>
        </Pressable>
      </View>
      {outbox === 'sending' && (
        <Text style={{ color: sub, fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>Bhej rahe hain…</Text>
      )}
      {outbox === 'failed' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Ionicons name="alert-circle" size={16} color={mine ? t.onAccent : t.danger} />
          <Text style={{ color: main, fontSize: 12, fontWeight: '700', marginLeft: 4, flex: 1 }}>Nahi gaya</Text>
          <Pressable
            onPress={() => { sendQueuedVoice(msg.clientId).catch(() => {}); }} hitSlop={6} accessibilityLabel="Retry voice note"
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.18)' }}
          >
            <Ionicons name="refresh" size={14} color={main} />
            <Text style={{ color: main, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => { unload(); deleteVoice(msg.clientId); }} hitSlop={6} accessibilityLabel="Delete voice note"
            style={{ marginLeft: 6, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' }}
          >
            <Ionicons name="trash-outline" size={15} color={main} />
          </Pressable>
        </View>
      )}
      {!tr && tv.text ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          <Text style={{ color: sub, fontSize: 12, fontStyle: 'italic', flexShrink: 1 }}>{tv.text}{tv.reason ? ': ' + tv.reason : ''}</Text>
          {tv.canRetry && (
            <Pressable
              onPress={retryTranscript} hitSlop={6} accessibilityLabel="Transcript dobara try karo"
              style={{ marginLeft: 8, paddingHorizontal: 8, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' }}
            >
              <Text style={{ color: main, fontSize: 12, fontWeight: '700' }}>Dobara try karo</Text>
            </Pressable>
          )}
        </View>
      ) : !!tr ? (
        <View style={{ marginTop: 4 }}>
          <Pressable onPress={() => setOpen(!expanded)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={sub} />
            <Text style={{ color: sub, fontSize: 12, fontWeight: '700', marginLeft: 3 }}>Transcript</Text>
          </Pressable>
          {expanded && <Text selectable style={{ color: main, fontSize: 14, marginTop: 2 }}>{tr}</Text>}
        </View>
      ) : null}
    </View>
  );
}
