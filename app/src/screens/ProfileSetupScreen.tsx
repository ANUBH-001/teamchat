// Round 4 onboarding (WhatsApp "Profile info"): shown once after login while user.profileDone === false.
import React, { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { api } from '../api';
import { setUser } from '../userStore';
import { compressImage, uploadMedia, useMediaSrc } from '../media';
import Avatar from '../components/Avatar';
import AvatarPicker from '../components/AvatarPicker';

export default function ProfileSetupScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateMe } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [photo, setPhoto] = useState<string | null>(null); // local uri picked now
  const [emoji, setEmoji] = useState<string | null>(user?.avatarEmoji || null);
  const [removed, setRemoved] = useState(false); // user chose Remove / emoji over the existing photo
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const existing = useMediaSrc(!photo && !removed ? user?.avatarUrl || null : null);
  if (!user) return null;
  const shown = photo || existing;

  const next = async () => {
    const n = name.trim();
    if (n.length < 2 || n.length > 60) { setErr('Name must be 2 to 60 characters'); return; }
    if (/[@#/]/.test(n)) { setErr('Name cannot contain @ # /'); return; }
    setBusy(true); setErr('');
    try {
      let avatarUrl: string | null = removed ? null : user.avatarUrl || null;
      if (photo) {
        const img = await compressImage(photo);
        avatarUrl = (await uploadMedia(img.uri, 'image', 'image/jpeg')).url;
      }
      await api('PATCH', '/auth/me', { name: n, avatarUrl, avatarEmoji: emoji, profileDone: true });
      setUser({ id: user.id, name: n, avatarEmoji: emoji, avatarUrl });
      updateMe({ name: n, avatarEmoji: emoji, avatarUrl, profileDone: true }); // lifts the onboarding gate
    } catch (e: any) {
      setErr(e.code === 'NAME_TAKEN' || /NAME_TAKEN/.test(e.message || '') ? 'This name is already taken. Please choose another' : e.message || 'Error');
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: insets.top + 48, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }}>Profile info</Text>
        <Text style={{ color: t.subtext, fontSize: 15, marginTop: 8, textAlign: 'center' }}>Set your name and photo</Text>
        <Pressable onPress={() => setPicker(true)} style={{ marginTop: 32 }}>
          {shown
            ? <Image source={{ uri: shown }} style={{ width: 140, height: 140, borderRadius: 70 }} />
            : <Avatar name={name || user.name} id={user.id} emoji={emoji} size={140} />}
          <View style={{ position: 'absolute', right: 0, bottom: 0, width: 42, height: 42, borderRadius: 21, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: t.background }}>
            <Ionicons name="camera" size={20} color={t.onAccent} />
          </View>
        </Pressable>
        <TextInput
          value={name} onChangeText={(v) => { setName(v); setErr(''); }} maxLength={60} placeholder="Your name" placeholderTextColor={t.subtext}
          style={{ alignSelf: 'stretch', marginTop: 36, backgroundColor: t.card, color: t.text, borderColor: err ? t.danger : t.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 }}
        />
        {!!err && <Text style={{ color: t.danger, alignSelf: 'stretch', marginTop: 8 }}>{err}</Text>}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={next} disabled={busy}
          style={{ alignSelf: 'stretch', marginTop: 32, backgroundColor: t.accent, borderRadius: 26, minHeight: 52, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={{ color: t.onAccent, fontSize: 17, fontWeight: '700' }}>Next</Text>}
        </Pressable>
      </ScrollView>
      <AvatarPicker
        visible={picker} onClose={() => setPicker(false)}
        onPhoto={(uri) => { setPhoto(uri); setRemoved(false); }} onEmoji={(e) => { setEmoji(e); setPhoto(null); setRemoved(true); }}
        onRemove={() => { setPhoto(null); setEmoji(null); setRemoved(true); }}
      />
    </KeyboardAvoidingView>
  );
}
