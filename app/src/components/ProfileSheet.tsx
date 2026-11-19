import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { setUser } from '../userStore';
import Avatar from './Avatar';
import Sheet from './Sheet';

const EMOJIS = ['😀', '😎', '🤓', '🥳', '😇', '🤠', '🧐', '😴', '🤩', '😺', '🐶', '🐱', '🦊', '🐼', '🦁', '🐯', '🐸', '🐵', '🦄', '🐧',
  '🦉', '🐢', '🐙', '🦋', '🐝', '🔥', '⚡', '🌟', '🌈', '🌙', '☀️', '🌸', '🌻', '🍀', '🌵', '🍎', '🍕', '🍔', '🍩', '☕',
  '⚽', '🏏', '🎮', '🎧', '🎸', '🚀', '✈️', '🚗', '💻', '📱', '💡', '🎯', '🏆', '💎', '👑', '🧠', '💪', '👍', '🙏', '❤️'];

// Edit name + emoji avatar. self -> PATCH /auth/me; admin editing another user -> PATCH /admin/users/:id.
export default function ProfileSheet({ visible, onClose, userId, name: n0, avatarEmoji: e0, onSaved }: {
  visible: boolean; onClose: () => void; userId: number; name: string; avatarEmoji?: string | null; onSaved?: () => void;
}) {
  const t = useTheme();
  const { user, updateMe } = useAuth();
  const self = !!user && user.id === userId;
  const [name, setName] = useState(n0);
  const [emoji, setEmoji] = useState<string | null>(e0 || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible) { setName(n0); setEmoji(e0 || null); setErr(''); } }, [visible, n0, e0]);

  const save = async () => {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) { setErr('Naam 2 se 60 akshar ka hona chahiye'); return; }
    if (/[@#/]/.test(n)) { setErr('Naam mein @ # / nahi chalega'); return; }
    setBusy(true); setErr('');
    try {
      const body = { name: n, avatarEmoji: emoji };
      if (self) {
        await api('PATCH', '/auth/me', body);
        updateMe({ name: n, avatarEmoji: emoji });
      } else {
        await api('PATCH', '/admin/users/' + userId, body);
      }
      setUser({ id: userId, name: n, avatarEmoji: emoji });
      onSaved && onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.code === 'NAME_TAKEN' || /NAME_TAKEN/.test(e.message || '') ? 'Ye naam pehle se kisi ka hai' : e.message || 'Error');
    }
    setBusy(false);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={self ? 'Edit profile' : 'Edit profile: ' + n0}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <Avatar name={name || n0} id={userId} emoji={emoji} size={72} />
        </View>
        <TextInput
          value={name} onChangeText={setName} maxLength={60} placeholder="Naam" placeholderTextColor={t.subtext}
          style={{ backgroundColor: t.background, color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 }}
        />
        <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 }}>EMOJI AVATAR</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Pressable
            onPress={() => setEmoji(null)}
            style={{ paddingHorizontal: 10, height: 44, borderRadius: 22, margin: 2, justifyContent: 'center', backgroundColor: emoji === null ? t.accent : t.background }}
          >
            <Text style={{ color: emoji === null ? '#fff' : t.text, fontSize: 13 }}>No emoji</Text>
          </Pressable>
          {EMOJIS.map((e) => (
            <Pressable
              key={e} onPress={() => setEmoji(e)}
              style={{ width: 44, height: 44, borderRadius: 22, margin: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: emoji === e ? t.accent + '55' : 'transparent', borderWidth: emoji === e ? 2 : 0, borderColor: t.accent }}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        {!!err && <Text style={{ color: t.danger, marginTop: 10 }}>{err}</Text>}
        <Pressable
          onPress={save} disabled={busy}
          style={{ backgroundColor: t.accent, borderRadius: 24, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: busy ? 0.6 : 1 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{busy ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
