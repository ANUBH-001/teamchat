// Round 4 Phase 3: WhatsApp-style composer row.  [ (emoji | input | attach | geo camera) ] (mic) (send)
// Presentational: ChatScreen owns the text, mentions, sheets and sending. Voice recording lives in VoiceRecorder.tsx.
import React, { useState } from 'react';
import { Animated, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { LockedBar, LockHint, RecordingBar, useMicGesture, useVoiceRecorder, VoiceResult } from './VoiceRecorder';

const EMOJI = (
  '😀 😃 😄 😁 😆 😅 😂 🤣 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😬 🙄 😯 😴 🤤 😪 😵 🤐 🤢 🤮 🤧 😷 ' +
  '👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 🙏 💪 👋 🤝 ☝️ 👆 👇 👈 👉 ✋ 🖐️ 👀 🧠 ' +
  '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 ✨ 🔥 ⭐ 🌟 🎉 🎊 🎁 🏆 ✅ ❌ ⚠️ ❓ ❗ 💡 📌 📎 📷 🎤 📞 💬 ⏰ 📅 📝 🚀 ☕ 🍕 🎂'
).split(' ');

type Props = {
  t: Theme;
  text: string;
  onChangeText: (v: string) => void;
  inputRef: React.RefObject<TextInput>;
  onFocus: () => void;
  onBlur: () => void;
  editing: boolean;
  canSend: boolean;
  onSend: () => void;
  onAttach: () => void;
  onGeo: () => void;
  onVoice: (r: VoiceResult) => void;
  onNotice: (msg: string) => void; // toast: too short / permission
  voiceHint?: string | null; // "Bolo: kis ko, kya task" while the text is a /task /re /done command
  bottom: number; // safe-area inset
};

export default function Composer({
  t, text, onChangeText, inputRef, onFocus, onBlur, editing, canSend, onSend, onAttach, onGeo, onVoice, onNotice, voiceHint, bottom,
}: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const r = useVoiceRecorder({
    onDone: onVoice,
    onShort: () => onNotice('Mic dabake rakho aur bolo (kam se kam 1 second)'),
    onError: onNotice,
  });
  const mic = useMicGesture(r, !editing);
  const recording = r.state !== 'idle';

  const toggleEmoji = () => {
    if (emojiOpen) { setEmojiOpen(false); inputRef.current?.focus(); }
    else { Keyboard.dismiss(); setEmojiOpen(true); }
  };
  const iconBtn = (name: keyof typeof Ionicons.glyphMap, onPress: () => void, label: string) => (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={4} style={{ width: 38, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={24} color={t.subtext} />
    </Pressable>
  );

  return (
    <View>
      {!!voiceHint && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 14, paddingHorizontal: 10, height: 28 }}>
            <Ionicons name="mic" size={14} color={t.chipText} />
            <Text style={{ color: t.chipText, fontSize: 12, fontWeight: '600', marginLeft: 5 }}>{voiceHint}</Text>
          </View>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingTop: 4, paddingBottom: emojiOpen ? 6 : 8 + bottom }}>
        {r.state === 'locked' ? (
          <LockedBar t={t} r={r} />
        ) : (
          <>
            {r.state === 'rec' ? (
              <RecordingBar key="recbar" t={t} ms={r.ms} levels={r.levels} dragX={mic.dragX} />
            ) : (
              <View key="pill" style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: t.card, borderRadius: 24, minHeight: 48, paddingHorizontal: 2 }}>
                {iconBtn(emojiOpen ? 'keypad-outline' : 'happy-outline', toggleEmoji, 'Emoji')}
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={onChangeText}
                  onFocus={() => { setEmojiOpen(false); onFocus(); }}
                  onBlur={onBlur}
                  placeholder="Message"
                  placeholderTextColor={t.subtext}
                  multiline
                  style={{ flex: 1, maxHeight: 120, color: t.text, paddingHorizontal: 4, paddingVertical: 12, fontSize: 16 }}
                />
                {!editing && iconBtn('attach', onAttach, 'Attach')}
                {!editing && iconBtn('camera-outline', onGeo, 'Geo camera')}
              </View>
            )}
            {!editing && (
              <Animated.View
                key="mic"
                {...mic.panHandlers}
                accessibilityLabel="Voice note (hold)"
                style={{
                  width: 48, height: 48, borderRadius: 24, marginLeft: 6, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: t.accent, transform: [{ scale: r.state === 'rec' ? 1.35 : 1 }, { translateX: mic.dragX }, { translateY: mic.dragY }],
                }}
              >
                <Ionicons name="mic" size={24} color={t.onAccent} />
              </Animated.View>
            )}
            {!recording && (
              <Pressable
                key="send" onPress={onSend} accessibilityLabel="Send" // Round 4: not disabled (a tap before the text state updated was swallowed); send() ignores empty text
                style={{ width: 48, height: 48, borderRadius: 24, marginLeft: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: canSend ? 1 : 0.4 }}
              >
                <Ionicons name={editing ? 'checkmark' : 'send'} size={22} color={t.onAccent} />
              </Pressable>
            )}
          </>
        )}
      </View>
      {r.state === 'rec' && <LockHint t={t} dragY={mic.dragY} />}
      {emojiOpen && (
        <View style={{ height: 230, backgroundColor: t.card, paddingBottom: bottom }}>
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }} keyboardShouldPersistTaps="always">
            {EMOJI.map((e, i) => (
              <Pressable key={i} onPress={() => onChangeText(text + e)} style={{ width: '12.5%', height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
