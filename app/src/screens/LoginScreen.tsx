import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, useColorScheme } from 'react-native';
import { light, dark } from '../theme';
import { useAuth } from '../auth';

export default function LoginScreen() {
  const t = useColorScheme() === 'dark' ? dark : light;
  const { login, activate } = useAuth();
  const [mode, setMode] = useState<'login' | 'activate'>('login');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'login') await login(phone.trim(), pin);
      else await activate(phone.trim(), code.trim(), pin);
    } catch (e: any) {
      setErr(e.message || 'Something went wrong');
    }
    setBusy(false);
  };

  const input = {
    backgroundColor: t.card, color: t.text, borderColor: t.border, borderWidth: 1,
    borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12,
  } as const;

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: t.background }}>
      <Text style={{ fontSize: 28, fontWeight: '700', color: t.primary, textAlign: 'center', marginBottom: 4 }}>
        Team Chat
      </Text>
      <Text style={{ color: t.subtext, textAlign: 'center', marginBottom: 24 }}>
        {mode === 'login' ? 'Log in with your phone and PIN' : 'First time? Enter your invite code and choose a PIN'}
      </Text>
      <TextInput style={input} placeholder="Phone" placeholderTextColor={t.subtext} keyboardType="phone-pad"
        value={phone} onChangeText={setPhone} autoCapitalize="none" />
      {mode === 'activate' && (
        <TextInput style={input} placeholder="Invite code" placeholderTextColor={t.subtext}
          value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} />
      )}
      <TextInput style={input} placeholder={mode === 'login' ? 'PIN' : 'New PIN (4-6 digits)'}
        placeholderTextColor={t.subtext} keyboardType="number-pad" secureTextEntry maxLength={6}
        value={pin} onChangeText={setPin} />
      {!!err && <Text style={{ color: '#D32F2F', marginBottom: 12 }}>{err}</Text>}
      <TouchableOpacity onPress={submit} disabled={busy}
        style={{ backgroundColor: t.accent, borderRadius: 24, padding: 14, alignItems: 'center' }}>
        {busy ? <ActivityIndicator color="#fff" /> :
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
            {mode === 'login' ? 'Log in' : 'Activate'}
          </Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setErr(''); setMode(mode === 'login' ? 'activate' : 'login'); }}
        style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={{ color: t.primary }}>
          {mode === 'login' ? 'I have an invite code' : 'Back to log in'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
