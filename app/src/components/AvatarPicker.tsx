// Round 4: "Camera / Gallery / Emoji / Remove" sheet for a profile picture (used by ProfileSetupScreen and ProfileSheet).
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../useTheme';
import { pickPhoto } from '../media';
import Sheet, { SheetRow } from './Sheet';

export const EMOJIS = ['😀', '😎', '🤓', '🥳', '😇', '🤠', '🧐', '😴', '🤩', '😺', '🐶', '🐱', '🦊', '🐼', '🦁', '🐯', '🐸', '🐵', '🦄', '🐧',
  '🦉', '🐢', '🐙', '🦋', '🐝', '🔥', '⚡', '🌟', '🌈', '🌙', '☀️', '🌸', '🌻', '🍀', '🌵', '🍎', '🍕', '🍔', '🍩', '☕',
  '⚽', '🏏', '🎮', '🎧', '🎸', '🚀', '✈️', '🚗', '💻', '📱', '💡', '🎯', '🏆', '💎', '👑', '🧠', '💪', '👍', '🙏', '❤️'];

export default function AvatarPicker({ visible, onClose, onPhoto, onEmoji, onRemove }: {
  visible: boolean; onClose: () => void; onPhoto: (uri: string) => void; onEmoji: (e: string) => void; onRemove: () => void;
}) {
  const t = useTheme();
  const [grid, setGrid] = useState(false);
  useEffect(() => { if (visible) setGrid(false); }, [visible]);
  // let the sheet close before the system camera / gallery opens (Android drops a Modal shown while another fades out)
  const pick = (src: 'camera' | 'gallery') => {
    onClose();
    setTimeout(async () => { const uri = await pickPhoto(src, true); if (uri) onPhoto(uri); }, 350);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Profile photo">
      {grid ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 12 }}>
          {EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => { onEmoji(e); onClose(); }} style={{ width: 44, height: 44, margin: 2, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26 }}>{e}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setGrid(false)} style={{ width: '100%', padding: 12 }}>
            <Text style={{ color: t.accent, fontWeight: '600' }}>Back</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <SheetRow icon="camera-outline" label="Camera" onPress={() => pick('camera')} />
          <SheetRow icon="images-outline" label="Gallery" onPress={() => pick('gallery')} />
          <SheetRow icon="happy-outline" label="Emoji" onPress={() => setGrid(true)} />
          <SheetRow icon="trash-outline" label="Remove photo" danger onPress={() => { onRemove(); onClose(); }} />
        </>
      )}
    </Sheet>
  );
}
