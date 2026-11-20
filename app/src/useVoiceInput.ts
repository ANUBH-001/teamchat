import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, ToastAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import type { ExpoSpeechRecognitionOptions } from 'expo-speech-recognition';

// Voice typing with Android's on-device SpeechRecognizer (expo-speech-recognition).
// The native module only exists in a dev/release build, not in Expo Go: there it is null and
// `available` is false, so the chat screen simply keeps its normal Send button.
const Native: any = requireOptionalNativeModule('ExpoSpeechRecognition');

export type VoiceLang = 'hi-IN' | 'en-IN';
const LANG_KEY = 'voiceLang';
const BARS = 60; // waveform history length
const MAX_MS = 60000; // hard stop after one minute

export const toast = (msg: string) => ToastAndroid.show(msg, ToastAndroid.SHORT);

export function useVoiceInput() {
  const available = !!Native;
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const [lang, setLang] = useState<VoiceLang>('hi-IN');

  const finals = useRef(''); // finished segments
  const partial = useRef(''); // current segment, still changing
  const subs = useRef<{ remove: () => void }[]>([]);
  const endWaiter = useRef<(() => void) | null>(null);
  const onAutoEnd = useRef<((text: string) => void) | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false); // a session is running (or stopping)
  const stopping = useRef(false); // stop/cancel requested by the user

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((v) => { if (v === 'en-IN' || v === 'hi-IN') setLang(v); }).catch(() => {});
  }, []);

  const text = () => (finals.current + ' ' + partial.current).replace(/\s+/g, ' ').trim();

  const cleanup = () => {
    subs.current.forEach((s) => s.remove());
    subs.current = [];
    if (maxTimer.current) clearTimeout(maxTimer.current);
    maxTimer.current = null;
    active.current = false;
    setRecording(false);
    setLevels(new Array(BARS).fill(0));
  };

  const listen = () => {
    const add = (name: string, fn: (e: any) => void) => subs.current.push(Native.addListener(name, fn));
    add('result', (e: { isFinal: boolean; results: { transcript: string }[] }) => {
      const best = e.results?.[0]?.transcript ?? '';
      if (e.isFinal) { finals.current = (finals.current + ' ' + best).trim(); partial.current = ''; }
      else partial.current = best;
      setTranscript(text());
    });
    add('volumechange', (e: { value: number }) => {
      const v = Math.max(0, Math.min(1, e.value / 10)); // native range is about -2..10, <= 0 is silence
      setLevels((cur) => [...cur.slice(1), v]);
    });
    add('error', (e: { error: string; message: string }) => {
      if (e.error === 'aborted' || stopping.current) return;
      if (e.error === 'not-allowed') askSettings();
      else if (e.error === 'network') toast('Voice: no internet connection');
      else if (e.error === 'language-not-supported') toast('This language is not available on this phone');
      else if (e.error !== 'no-speech' && e.error !== 'speech-timeout') toast('Voice error: ' + e.error);
    });
    add('end', () => {
      const userStopped = stopping.current;
      cleanup();
      if (endWaiter.current) { endWaiter.current(); endWaiter.current = null; }
      else if (!userStopped && onAutoEnd.current) onAutoEnd.current(text()); // silence / timeout / error
    });
  };

  const askSettings = () =>
    Alert.alert('Microphone', 'Voice typing needs microphone permission. Allow it in Settings > TeamChat > Permissions > Microphone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open settings', onPress: () => Linking.openSettings() },
    ]);

  const begin = (l: VoiceLang) => {
    const opts: ExpoSpeechRecognitionOptions = {
      lang: l,
      interimResults: true,
      continuous: true,
      addsPunctuation: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: 80 },
    };
    stopping.current = false;
    active.current = true;
    listen();
    Native.start(opts);
    setRecording(true);
    maxTimer.current = setTimeout(() => { if (active.current) Native.stop(); }, MAX_MS);
  };

  // onAutoEnd: called with the transcript when recognition ends by itself (silence, time limit, error)
  const start = useCallback(async (autoEnd: (text: string) => void) => {
    if (!Native) { toast('Voice needs the dev build'); return; }
    if (active.current) return;
    try {
      if (!Native.isRecognitionAvailable()) { toast('Speech recognition is not available on this phone'); return; }
      const p = await Native.requestPermissionsAsync();
      if (!p.granted) { askSettings(); return; }
      finals.current = ''; partial.current = '';
      setTranscript('');
      onAutoEnd.current = autoEnd;
      begin(lang);
    } catch (e: any) {
      cleanup();
      toast('Voice did not start');
    }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // stop listening and return the transcript (waits briefly for the last final result)
  const finish = useCallback(async (): Promise<string> => {
    if (!active.current) return text();
    stopping.current = true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { endWaiter.current = null; try { Native.abort(); } catch (e) {} cleanup(); resolve(); }, 2500);
      endWaiter.current = () => { clearTimeout(timer); resolve(); };
      try { Native.stop(); } catch (e) { endWaiter.current = null; clearTimeout(timer); cleanup(); resolve(); }
    });
    return text();
  }, []);

  const cancel = useCallback(() => {
    stopping.current = true;
    finals.current = ''; partial.current = '';
    setTranscript('');
    if (active.current) { try { Native.abort(); } catch (e) {} }
    cleanup();
  }, []);

  // switch language; while recording, restart the recognizer and keep what was heard so far
  const toggleLang = useCallback(async () => {
    const next: VoiceLang = lang === 'hi-IN' ? 'en-IN' : 'hi-IN';
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
    if (!active.current) return;
    finals.current = text(); partial.current = '';
    stopping.current = true;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { endWaiter.current = null; cleanup(); resolve(); }, 1500);
      endWaiter.current = () => { clearTimeout(timer); resolve(); };
      try { Native.abort(); } catch (e) { endWaiter.current = null; clearTimeout(timer); cleanup(); resolve(); }
    });
    try { begin(next); } catch (e) { cleanup(); toast('Voice did not start'); }
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (active.current) { stopping.current = true; try { Native.abort(); } catch (e) {} cleanup(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { available, recording, transcript, levels, lang, start, finish, cancel, toggleLang };
}
