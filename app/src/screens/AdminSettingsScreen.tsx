import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, TextInput, Alert, ActivityIndicator, RefreshControl, Modal, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  retentionEnabled: boolean; taskReminderDays: number; taskDeleteDays: number; messageRetentionDays: number;
};
type Ai = { provider: string; model: string; hasKey: boolean; lastError: { code: string; message: string; at: string } | null };
type BoolKey = 'aiEnabled' | 'aiDetect' | 'commandsEnabled' | 'membersCanAssign' | 'notifyAdminOnMemberChanges' | 'quietTaskNotifs' | 'praiseEnabled'
  | 'retentionEnabled';
type DayKey = 'taskReminderDays' | 'taskDeleteDays' | 'messageRetentionDays';
const DAY_ROWS: { key: DayKey; label: string; sub: string; min: number }[] = [
  { key: 'taskReminderDays', label: 'Pending reminder after (days)', sub: 'Ek baar yaad dilana + admin alert (0 = off)', min: 0 },
  { key: 'taskDeleteDays', label: 'Delete tasks after (days)', sub: 'Remove old tasks, done or not', min: 1 },
  { key: 'messageRetentionDays', label: 'Delete messages after (days)', sub: 'Every Sunday 11 PM (the pinned message is kept)', min: 1 },
];

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
// Round 4: moved from SettingsScreen.tsx (the new SettingsScreen is the WhatsApp-style main Settings); opened from Admin panel.
export default function AdminSettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<S | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const [err, setErr] = useState('');
  const [upd, setUpd] = useState({ minVersionCode: '', latestVersionCode: '', latestVersionName: '', apkUrl: '', updateMessage: '' });
  // Android back = back to the Admin list (not out of the tab)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedMsg, setSavedMsg] = useState('');
  const [days, setDays] = useState<Record<DayKey, string>>({ taskReminderDays: '', taskDeleteDays: '', messageRetentionDays: '' });
  const [daysMsg, setDaysMsg] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [resetting, setResetting] = useState(false);

  const apply = (r: { settings: S; ai?: Ai }) => {
    setS(r.settings);
    if (r.ai) setAi(r.ai);
    setDays({
      taskReminderDays: String(r.settings.taskReminderDays ?? 6), taskDeleteDays: String(r.settings.taskDeleteDays ?? 14),
      messageRetentionDays: String(r.settings.messageRetentionDays ?? 7),
    });
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
  const saveDays = async () => {
    const body: Partial<Record<DayKey, number>> = {};
    for (const r of DAY_ROWS) {
      const n = Number(days[r.key]);
      if (!Number.isInteger(n) || n < r.min) { Alert.alert('Days', r.label + ': ' + 'enter ' + r.min + ' or more.'); return; }
      body[r.key] = n;
    }
    try {
      setS((await api<{ settings: S }>('PUT', '/admin/settings', body)).settings);
      setDaysMsg('Saved');
      setTimeout(() => setDaysMsg(''), 2000);
    } catch (e: any) { Alert.alert('Could not save', e.message); }
  };
  const doReset = async () => {
    if (resetText.trim() !== 'RESET' || resetting) return;
    setResetting(true);
    try {
      const r = await api<{ ok: boolean; backup: string }>('POST', '/admin/reset', { confirm: 'RESET' });
      setResetOpen(false); setResetText('');
      Alert.alert('Reset done', 'All chat and task data was removed. Backup: ' + r.backup);
    } catch (e: any) { Alert.alert('Reset failed', e.message); }
    setResetting(false);
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
      <View style={{ backgroundColor: t.header, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' }}>
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

          <Text style={head}>Data retention</Text>
          <View style={card}>
            <Row label="Auto delete old data" sub="Permanently delete messages and old tasks (a JSON backup is made first)" value={!!s.retentionEnabled} onChange={(v) => toggle('retentionEnabled', v)} t={t} />
            {DAY_ROWS.map((r) => (
              <View key={r.key}>
                <View style={{ height: 1, backgroundColor: t.border, marginLeft: 16 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 16 }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: t.text, fontSize: 15 }}>{r.label}</Text>
                    <Text style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{r.sub}</Text>
                  </View>
                  <TextInput
                    keyboardType="number-pad" value={days[r.key]} onChangeText={(v) => setDays({ ...days, [r.key]: v.replace(/[^0-9]/g, '') })}
                    style={{ width: 64, minHeight: 44, borderRadius: 12, backgroundColor: t.soft, color: t.text, textAlign: 'center', fontSize: 16, fontWeight: '600' }}
                  />
                </View>
              </View>
            ))}
            <View style={{ padding: 16, paddingTop: 4 }}>
              <Pressable onPress={saveDays} style={{ minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.accent, fontWeight: '700' }}>{daysMsg || 'Save days'}</Text>
              </Pressable>
            </View>
          </View>

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

          <Text style={{ ...head, color: t.danger }}>Danger zone</Text>
          <View style={{ ...card, padding: 16, borderWidth: 1, borderColor: t.danger }}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>Reset app data</Text>
            <Text style={{ color: t.subtext, fontSize: 12, marginTop: 4 }}>
              All messages, tasks, check-ins, groups and DMs are deleted permanently. Users, PINs, settings, All Team and check-in chats are kept. A full backup is made first.
            </Text>
            <Pressable onPress={() => { setResetText(''); setResetOpen(true); }} style={{ marginTop: 12, minHeight: 48, borderRadius: 24, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Reset app data...</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
      <Modal visible={resetOpen} transparent animationType="fade" onRequestClose={() => setResetOpen(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: t.card, borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="warning" size={22} color={t.danger} />
              <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginLeft: 8 }}>Delete all data?</Text>
            </View>
            <Text style={{ color: t.subtext, fontSize: 14, marginTop: 10 }}>This cannot be undone. Type RESET to confirm.</Text>
            <TextInput
              value={resetText} onChangeText={setResetText} autoCapitalize="characters" autoCorrect={false} placeholder="RESET" placeholderTextColor={t.subtext}
              style={{ backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16, marginTop: 14, letterSpacing: 2 }}
            />
            <View style={{ flexDirection: 'row', marginTop: 16 }}>
              <Pressable onPress={() => setResetOpen(false)} style={{ flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                <Text style={{ color: t.text, fontWeight: '600' }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={doReset} disabled={resetText.trim() !== 'RESET' || resetting}
                style={{ flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', opacity: resetText.trim() === 'RESET' && !resetting ? 1 : 0.4 }}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>{resetting ? 'Resetting...' : 'Reset'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
