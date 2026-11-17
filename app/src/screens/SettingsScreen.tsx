import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useTheme } from '../useTheme';
import { usePullRefresh } from '../useLive';
import { Theme } from '../theme';
import { VERSION_CODE, VERSION_NAME } from '../version';

type S = {
  aiEnabled: boolean; aiDetect: boolean; commandsEnabled: boolean; membersCanAssign: boolean;
  notifyAdminOnMemberChanges: boolean; quietTaskNotifs: boolean; praiseEnabled: boolean;
  minVersionCode: number; latestVersionCode: number; latestVersionName: string; apkUrl: string; updateMessage: string;
};
type Ai = { provider: string; model: string; hasKey: boolean; lastError: { code: string; message: string; at: string } | null };
type BoolKey = 'aiEnabled' | 'aiDetect' | 'commandsEnabled' | 'membersCanAssign' | 'notifyAdminOnMemberChanges' | 'quietTaskNotifs' | 'praiseEnabled';

const GROUPS: { title: string; rows: { key: BoolKey; label: string; sub: string }[] }[] = [
  { title: 'AI & Commands', rows: [
    { key: 'aiEnabled', label: 'AI', sub: 'Master switch for AI features' },
    { key: 'aiDetect', label: 'Detect tasks in messages', sub: 'AI reads normal chat for tasks' },
    { key: 'commandsEnabled', label: 'Slash commands', sub: '/task, /done, /update ...' },
  ] },
  { title: 'Permissions', rows: [
    { key: 'membersCanAssign', label: 'Members can create and assign tasks', sub: 'Otherwise only admin assigns' },
    { key: 'praiseEnabled', label: 'Praise', sub: 'Allow the 👏 praise button' },
  ] },
  { title: 'Notifications', rows: [
    { key: 'notifyAdminOnMemberChanges', label: 'Notify admin of member changes', sub: 'Task done / testing / new' },
    { key: 'quietTaskNotifs', label: 'Quiet task notifications', sub: 'No sound for task updates' },
  ] },
];

const Row = ({ label, sub, value, onChange, t }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void; t: Theme }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 16 }}>
    <View style={{ flex: 1, paddingRight: 12 }}>
      <Text style={{ color: t.text, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{sub}</Text>
    </View>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent, false: t.border }} thumbColor="#fff" />
  </View>
);

// Admin only: GET/PUT /admin/settings. Switches save at once; the app-update fields save with their button.
export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<S | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const [err, setErr] = useState('');
  const [upd, setUpd] = useState({ minVersionCode: '', latestVersionCode: '', latestVersionName: '', apkUrl: '', updateMessage: '' });
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const apply = (r: { settings: S; ai?: Ai }) => {
    setS(r.settings);
    if (r.ai) setAi(r.ai);
    setUpd({
      minVersionCode: String(r.settings.minVersionCode ?? 0), latestVersionCode: String(r.settings.latestVersionCode ?? 0),
      latestVersionName: r.settings.latestVersionName ?? '', apkUrl: r.settings.apkUrl ?? '', updateMessage: r.settings.updateMessage ?? '',
    });
  };
  const load = useCallback(async () => {
    try { apply(await api('GET', '/admin/settings')); setErr(''); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const { refreshing, onRefresh } = usePullRefresh(load);

  const toggle = async (k: BoolKey, v: boolean) => {
    if (!s) return;
    const old = s;
    setS({ ...s, [k]: v });
    try { setS((await api<{ settings: S }>('PUT', '/admin/settings', { [k]: v })).settings); }
    catch (e: any) { setS(old); Alert.alert('Could not save', e.message); }
  };
  const saveUpdate = async () => {
    const min = Number(upd.minVersionCode), latest = Number(upd.latestVersionCode);
    if (!Number.isInteger(min) || !Number.isInteger(latest) || min < 0 || latest < 0) { Alert.alert('Version codes', 'Use whole numbers (0 or more).'); return; }
    const go = async () => {
      try {
        const r = await api<{ settings: S }>('PUT', '/admin/settings', {
          minVersionCode: min, latestVersionCode: latest, latestVersionName: upd.latestVersionName.trim(),
          apkUrl: upd.apkUrl.trim(), updateMessage: upd.updateMessage.trim(),
        });
        setS(r.settings);
        setSavedMsg('Saved');
        setTimeout(() => setSavedMsg(''), 2000);
      } catch (e: any) { Alert.alert('Could not save', e.message); }
    };
    if (min > VERSION_CODE) {
      Alert.alert('Block this app?', 'Minimum version ' + min + ' is higher than this app (' + VERSION_CODE + '). Everyone below it, including you, is locked out until they install the new APK.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Save anyway', style: 'destructive', onPress: go },
      ]);
    } else go();
  };
  const testAi = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await api<{ ok: boolean; code?: string; message?: string }>('POST', '/admin/settings/test-ai', {});
      setTestMsg(r.ok ? { ok: true, text: 'AI works' } : { ok: false, text: (r.code ? r.code + ': ' : '') + (r.message || 'Failed') });
      load();
    } catch (e: any) { setTestMsg({ ok: false, text: e.message }); }
    setTesting(false);
  };

  const card = { backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, overflow: 'hidden' } as const;
  const head = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginHorizontal: 32, marginTop: 24, marginBottom: 8 } as const;
  const input = { backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 15, marginBottom: 10 } as const;
  const lbl = { color: t.subtext, fontSize: 12, marginBottom: 4 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={{ backgroundColor: t.primary, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ paddingRight: 12 }}>
          <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
        </Pressable>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>Settings</Text>
      </View>
      {!s ? (
        err ? <Text style={{ color: t.danger, padding: 20 }}>{err}</Text> : <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        >
          {GROUPS.map((g) => (
            <View key={g.title}>
              <Text style={head}>{g.title}</Text>
              <View style={card}>
                {g.rows.map((r, i) => (
                  <View key={r.key}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />}
                    <Row label={r.label} sub={r.sub} value={!!s[r.key]} onChange={(v) => toggle(r.key, v)} t={t} />
                  </View>
                ))}
                {g.title === 'AI & Commands' && ai && (
                  <>
                    <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />
                    <View style={{ padding: 16 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ai.hasKey && !ai.lastError ? t.accent : ai.hasKey ? '#F5A623' : t.danger, marginRight: 10 }} />
                        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{ai.provider} · {ai.model}</Text>
                        <Text style={{ color: t.subtext, fontSize: 12 }}>{ai.hasKey ? 'Key set' : 'No key'}</Text>
                      </View>
                      {!!ai.lastError && (
                        <Text style={{ color: '#F5A623', fontSize: 12, marginTop: 8 }}>
                          Last error {ai.lastError.code}: {ai.lastError.message}
                        </Text>
                      )}
                      {!!testMsg && <Text style={{ color: testMsg.ok ? t.accent : t.danger, fontSize: 13, marginTop: 8 }}>{testMsg.text}</Text>}
                      <Pressable onPress={testAi} disabled={testing} style={{ marginTop: 12, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: testing ? 0.6 : 1 }}>
                        <Text style={{ color: t.accent, fontWeight: '700' }}>{testing ? 'Testing...' : 'Test AI'}</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            </View>
          ))}

          <Text style={head}>App update</Text>
          <View style={{ ...card, padding: 16 }}>
            <Text style={{ color: t.subtext, fontSize: 12, marginBottom: 12 }}>This app: {VERSION_NAME} (code {VERSION_CODE}). Below the minimum = blocked until updated.</Text>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={lbl}>Minimum version code</Text>
                <TextInput style={input} keyboardType="number-pad" value={upd.minVersionCode} onChangeText={(v) => setUpd({ ...upd, minVersionCode: v })} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={lbl}>Latest version code</Text>
                <TextInput style={input} keyboardType="number-pad" value={upd.latestVersionCode} onChangeText={(v) => setUpd({ ...upd, latestVersionCode: v })} />
              </View>
            </View>
            <Text style={lbl}>Latest version name</Text>
            <TextInput style={input} value={upd.latestVersionName} onChangeText={(v) => setUpd({ ...upd, latestVersionName: v })} placeholder="0.2.0" placeholderTextColor={t.subtext} />
            <Text style={lbl}>APK download URL</Text>
            <TextInput style={input} autoCapitalize="none" autoCorrect={false} value={upd.apkUrl} onChangeText={(v) => setUpd({ ...upd, apkUrl: v })} placeholder="https://..." placeholderTextColor={t.subtext} />
            <Text style={lbl}>Message shown to users</Text>
            <TextInput style={{ ...input, minHeight: 72, textAlignVertical: 'top', paddingTop: 12 }} multiline value={upd.updateMessage} onChangeText={(v) => setUpd({ ...upd, updateMessage: v })} />
            <Pressable onPress={saveUpdate} style={{ minHeight: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{savedMsg || 'Save update settings'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
