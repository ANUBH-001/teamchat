import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { setUser } from '../userStore';
import { compressImage, uploadMedia, useMediaSrc } from '../media';
import Avatar from './Avatar';
import AvatarPicker, { EMOJIS } from './AvatarPicker';
import Sheet from './Sheet';

// Edit name + DP. self -> PATCH /auth/me {name, avatarEmoji, avatarUrl?}; admin editing another user -> PATCH /admin/users/:id
// (emoji only). Self DP: photo from camera/gallery (uploaded with uploadMedia), emoji, or none (initials).
export default function ProfileSheet({ visible, onClose, userId, name: n0, avatarEmoji: e0, onSaved }: {
  visible: boolean; onClose: () => void; userId: number; name: string; avatarEmoji?: string | null; onSaved?: () => void;
}) {
  const t = useTheme();
  const { user, updateMe } = useAuth();
  const self = !!user && user.id === userId;
  const [name, setName] = useState(n0);
  const [emoji, setEmoji] = useState<string | null>(e0 || null);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = removed, string = new local uri
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible) { setName(n0); setEmoji(e0 || null); setPhoto(undefined); setErr(''); } }, [visible, n0, e0]);
  const currentUrl = useMediaSrc(self && photo === undefined ? user?.avatarUrl || null : null);

  const save = async () => {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) { setErr('Name must be 2 to 60 characters'); return; }
    if (/[@#/]/.test(n)) { setErr('Name cannot contain @ # /'); return; }
    setBusy(true); setErr('');
    try {
      const body: any = { name: n, avatarEmoji: emoji };
      if (self) {
        if (typeof photo === 'string') {
          const img = await compressImage(photo);
          body.avatarUrl = (await uploadMedia(img.uri, 'image', 'image/jpeg')).url;
        } else if (photo === null) body.avatarUrl = null;
        await api('PATCH', '/auth/me', body);
        updateMe({ name: n, avatarEmoji: emoji, ...('avatarUrl' in body ? { avatarUrl: body.avatarUrl } : {}) });
        setUser({ id: userId, name: n, avatarEmoji: emoji, ...('avatarUrl' in body ? { avatarUrl: body.avatarUrl } : {}) });
      } else {
        await api('PATCH', '/admin/users/' + userId, body);
        setUser({ id: userId, name: n, avatarEmoji: emoji });
      }
      onSaved && onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.code === 'NAME_TAKEN' || /NAME_TAKEN/.test(e.message || '') ? 'This name is already taken' : e.message || 'Error');
    }
    setBusy(false);
  };

  const preview = typeof photo === 'string' ? photo : currentUrl;
  return (
    <Sheet visible={visible} onClose={onClose} title={self ? 'Edit profile' : 'Edit profile: ' + n0}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Pressable disabled={!self} onPress={() => setPicker(true)} style={{ alignItems: 'center', marginBottom: 12 }}>
          {preview
            ? <Image source={{ uri: preview }} style={{ width: 88, height: 88, borderRadius: 44 }} />
            : <Avatar name={name || n0} id={userId} emoji={emoji} size={88} />}
          {self && <Text style={{ color: t.accent, fontWeight: '600', marginTop: 6 }}>Change photo</Text>}
        </Pressable>
        <TextInput
          value={name} onChangeText={setName} maxLength={60} placeholder="Name" placeholderTextColor={t.subtext}
          style={{ backgroundColor: t.background, color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 }}
        />
        {!self && (
          <>
            <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginTop: 14, marginBottom: 6 }}>EMOJI AVATAR</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Pressable
                onPress={() => setEmoji(null)}
                style={{ paddingHorizontal: 10, height: 44, borderRadius: 22, margin: 2, justifyContent: 'center', backgroundColor: emoji === null ? t.accent : t.background }}
              >
                <Text style={{ color: emoji === null ? t.onAccent : t.text, fontSize: 13 }}>No emoji</Text>
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
          </>
        )}
        {!!err && <Text style={{ color: t.danger, marginTop: 10 }}>{err}</Text>}
        <Pressable
          onPress={save} disabled={busy}
          style={{ backgroundColor: t.accent, borderRadius: 24, minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 14, opacity: busy ? 0.6 : 1 }}
        >
          <Text style={{ color: t.onAccent, fontWeight: '700', fontSize: 16 }}>{busy ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>
      <AvatarPicker
        visible={picker} onClose={() => setPicker(false)}
        onPhoto={(uri) => setPhoto(uri)} onEmoji={(e) => { setEmoji(e); setPhoto(null); }}
        onRemove={() => { setPhoto(null); setEmoji(null); }}
      />
    </Sheet>
  );
}
