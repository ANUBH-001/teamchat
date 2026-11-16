import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { VoiceLang } from '../useVoiceInput';

// Recording bar shown in place of the chat input: X | waveform + language chip | stop | send.
export default function VoiceBar({ t, levels, transcript, lang, onToggleLang, onCancel, onStop, onSend, bottom }: {
  t: Theme; levels: number[]; transcript: string; lang: VoiceLang; bottom: number;
  onToggleLang: () => void; onCancel: () => void; onStop: () => void; onSend: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 + bottom }}>
      {!!transcript && (
        <Text numberOfLines={2} style={{ color: t.subtext, fontSize: 13, marginHorizontal: 12, marginBottom: 4 }}>{transcript}</Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 26, paddingHorizontal: 4, height: 52 }}>
        <Pressable onPress={onCancel} hitSlop={6} accessibilityLabel="Cancel recording" style={btn}>
          <Ionicons name="close" size={24} color={t.text} />
        </Pressable>
        <Waveform levels={levels} color={t.text} dim={t.subtext} />
        <Pressable onPress={onToggleLang} hitSlop={6} accessibilityLabel="Voice language"
          style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: t.border, marginHorizontal: 4 }}>
          <Text style={{ color: t.text, fontSize: 12 }}>{lang === 'hi-IN' ? 'हिं' : 'EN'}</Text>
        </Pressable>
        <Pressable onPress={onStop} hitSlop={6} accessibilityLabel="Stop and edit" style={btn}>
          <Ionicons name="stop" size={20} color={t.text} />
        </Pressable>
        <Pressable onPress={onSend} accessibilityLabel="Send voice message"
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}>
          <Ionicons name="arrow-up" size={22} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const btn = { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' } as const;

// Thin vertical bars, newest on the right; quiet samples draw as dots (dotted baseline).
function Waveform({ levels, color, dim }: { levels: number[]; color: string; dim: string }) {
  return (
    <View style={{ flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
      {levels.map((v, i) => {
        const quiet = v < 0.08;
        return (
          <View key={i} style={{
            width: 3, marginLeft: 2, borderRadius: 1.5,
            height: quiet ? 3 : 4 + v * 30,
            backgroundColor: quiet ? dim : color,
          }} />
        );
      })}
    </View>
  );
}

// Mic button shown instead of Send while the text box is empty.
export function MicButton({ t, onPress }: { t: Theme; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel="Voice input"
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
      <Ionicons name="mic" size={22} color="#fff" />
    </Pressable>
  );
}
