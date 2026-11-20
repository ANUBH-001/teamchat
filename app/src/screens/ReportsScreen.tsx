import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, ScrollView, Switch, RefreshControl, ActivityIndicator, AppState, BackHandler,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useTheme } from '../useTheme';
import { usePullRefresh } from '../useLive';
import { Theme } from '../theme';
import { AdminDay, AdminUserHistory, Checkin, CheckinSettings, Signoff } from '../chatTypes';
import { labelOf } from '../taskTypes';

// Boss-only, pull-only: no websocket, no notifications. Refetches on pull, on focus and on foreground.
const GREEN = '#25A244';
const RED = '#D9534F';

const shiftDate = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, day + n));
  return x.toISOString().slice(0, 10);
};

const Pill = React.memo(function Pill({ label, status }: { label: string; status: 'submitted' | 'missing' }) {
  const ok = status === 'submitted';
  return (
    <View style={{ backgroundColor: ok ? GREEN : RED, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{label} {ok ? 'Submitted' : 'Missing'}</Text>
    </View>
  );
});

// Same green bar as Settings (the tab header is hidden on these sub-screens): below the status bar, full width.
function TopBar({ t, title, onBack }: { t: Theme; title: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: t.header, paddingTop: insets.top + 10, paddingBottom: 12, paddingHorizontal: 12, margin: -16, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ paddingRight: 12 }}>
        <Text style={{ color: '#fff', fontSize: 28, lineHeight: 30 }}>{'‹'}</Text>
      </Pressable>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }} numberOfLines={1}>{title}</Text>
    </View>
  );
}

// ---------------- day list ----------------
type Member = AdminDay['members'][number];

const MemberRow = React.memo(function MemberRow({ m, t, onPress }: { m: Member; t: Theme; onPress: (m: Member) => void }) {
  return (
    <Pressable onPress={() => onPress(m)} style={{ backgroundColor: t.card, borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <Text style={{ color: t.text, fontWeight: '600' }}>{m.name}{m.active ? '' : ' (inactive)'}</Text>
      <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill label="Sign-off" status={m.signoff ? m.signoff.status : 'missing'} />
        {!!m.signoff?.signoff && (
          <Text style={{ color: t.subtext, fontSize: 12, marginLeft: 8 }}>
            Done {m.signoff.signoff.counts.done} · Baaki {m.signoff.signoff.counts.left} · Aaj diye {m.signoff.signoff.counts.given}
          </Text>
        )}
        {(m.morning.status === 'submitted' || m.evening.status === 'submitted') && (
          <Text style={{ color: t.subtext, fontSize: 12, marginLeft: 8 }}>+ notes</Text>
        )}
      </View>
    </Pressable>
  );
});

export default function ReportsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const focused = useIsFocused();
  const [date, setDate] = useState(''); // '' = today (server decides)
  const [day, setDay] = useState<AdminDay | null>(null);
  const [today, setToday] = useState('');
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Member | null>(null);
  const dateRef = useRef(date);
  dateRef.current = date;

  const load = useCallback(async () => {
    const d = dateRef.current;
    try {
      const r = await api<AdminDay>('GET', '/admin/checkins' + (d ? '?date=' + d : ''));
      if (dateRef.current !== d) return; // user moved on meanwhile
      setDay(r);
      if (!d) setToday(r.date);
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => { if (focused) load(); }, [focused, date, load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  const { refreshing, onRefresh } = usePullRefresh(load);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sel) setSel(null); else onBack();
      return true;
    });
    return () => sub.remove();
  }, [sel, onBack]);

  const openMember = useCallback((m: Member) => setSel(m), []);
  const shown = day ? day.date : date;
  const atToday = !!today && !!day && day.date >= today;

  if (sel && day) return <MemberDetail member={sel} date={day.date} onBack={() => setSel(null)} />;

  const navBtn = { backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 } as const;
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: t.background }}>
      <TopBar t={t} title="Daily reports" onBack={onBack} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Pressable disabled={!shown} onPress={() => shown && setDate(shiftDate(shown, -1))} style={navBtn}>
          <Text style={{ color: t.text }}>{'‹ Prev'}</Text>
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{shown || '...'}</Text>
          {!atToday && (
            <Pressable onPress={() => setDate('')} hitSlop={6}>
              <Text style={{ color: t.primary, fontWeight: '600', fontSize: 13 }}>Today</Text>
            </Pressable>
          )}
        </View>
        <Pressable disabled={atToday || !shown} onPress={() => shown && setDate(shiftDate(shown, 1))} style={{ ...navBtn, opacity: atToday ? 0.4 : 1 }}>
          <Text style={{ color: t.text }}>{'Next ›'}</Text>
        </Pressable>
      </View>
      {!!err && <Text style={{ color: RED, marginBottom: 8 }}>{err}</Text>}
      {!!day && !day.workday && <Text style={{ color: t.subtext, marginBottom: 8 }}>Not a check-in day (off day or check-ins disabled).</Text>}
      <FlatList
        data={day ? day.members : []}
        keyExtractor={(m) => String(m.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        initialNumToRender={12}
        windowSize={9}
        renderItem={({ item }) => <MemberRow m={item} t={t} onPress={openMember} />}
        ListEmptyComponent={day ? <Text style={{ color: t.subtext }}>No members.</Text> : <ActivityIndicator color={t.accent} />}
      />
    </View>
  );
}

// ---------------- member detail ----------------
const Bullets = ({ title, items, t }: { title: string; items: string[]; t: Theme }) =>
  items.length ? (
    <View style={{ marginTop: 4 }}>
      <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{title}</Text>
      {items.map((s, i) => <Text key={i} style={{ color: t.text, fontSize: 14 }}>{'• ' + s}</Text>)}
    </View>
  ) : null;

const Entry = React.memo(function Entry({ c, label, t }: { c: Checkin | undefined; label: string; t: Theme }) {
  if (!c) return <Text style={{ color: RED, fontSize: 13, marginTop: 6 }}>{label}: missing</Text>;
  const picked = c.tasks.filter((x) => c.selectedTaskIds.includes(x.id)).map((x) => x.title);
  const changed = c.tasks.filter((x) => c.taskStatuses[String(x.id)]).map((x) => x.title + ' → ' + labelOf(c.taskStatuses[String(x.id)]));
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>{label}{c.edited ? ' (edited)' : ''}</Text>
      {!!c.text && <Text style={{ color: t.text, fontSize: 14, marginTop: 2 }}>{c.text}</Text>}
      <Bullets title="Selected tasks" items={picked} t={t} />
      <Bullets title="Task status" items={changed} t={t} />
      <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginTop: 6 }}>AI summary</Text>
      <Bullets title="Done" items={c.summary.done} t={t} />
      <Bullets title="Pending" items={c.summary.pending} t={t} />
      <Bullets title="Blockers" items={c.summary.blockers} t={t} />
    </View>
  );
});

type DayGroup = { date: string; morning?: Checkin; evening?: Checkin; signoff?: Signoff };

const SignoffEntry = ({ so, t }: { so: Signoff | undefined; t: Theme }) => {
  if (!so) return <Text style={{ color: RED, fontSize: 13, marginTop: 6 }}>Sign-off: missing</Text>;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13 }}>
        Sign-off · Done {so.counts.done} · Baaki {so.counts.left} · Aaj diye {so.counts.given}
      </Text>
      {so.tasks.map((x) => <Text key={x.id} style={{ color: t.text, fontSize: 14 }}>{'• ' + x.title + ' (' + labelOf(x.status) + ')'}</Text>)}
      {!!so.note && <Text style={{ color: t.text, fontSize: 14, fontStyle: 'italic', marginTop: 4 }}>{so.note}</Text>}
    </View>
  );
};

const DayCard = React.memo(function DayCard({ g, t, open, onToggle }: { g: DayGroup; t: Theme; open: boolean; onToggle: (d: string) => void }) {
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <Pressable onPress={() => onToggle(g.date)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: t.text, fontWeight: '600' }}>{g.date}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Pill label="Sign-off" status={g.signoff ? 'submitted' : 'missing'} />
        </View>
      </Pressable>
      {open && (
        <View>
          <SignoffEntry so={g.signoff} t={t} />
          {!!g.morning && <Entry c={g.morning} label="Notes (morning)" t={t} />}
          {!!g.evening && <Entry c={g.evening} label="Notes (evening)" t={t} />}
        </View>
      )}
    </View>
  );
});

function MemberDetail({ member, date, onBack }: { member: Member; date: string; onBack: () => void }) {
  const t = useTheme();
  const [span, setSpan] = useState<7 | 30>(7);
  const [data, setData] = useState<AdminUserHistory | null>(null);
  const [err, setErr] = useState('');
  const [openDates, setOpenDates] = useState<string[]>([date]);

  const load = useCallback(async () => {
    try {
      const r = await api<AdminUserHistory>('GET', '/admin/checkins/user/' + member.id + '?from=' + shiftDate(date, -(span - 1)) + '&to=' + date);
      setData(r);
      setErr('');
    } catch (e: any) {
      setErr(e.message);
    }
  }, [member.id, date, span]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);
  const { refreshing, onRefresh } = usePullRefresh(load);

  const groups = useMemo(() => {
    const map = new Map<string, DayGroup>();
    map.set(date, { date });
    for (const c of data ? data.checkins : []) {
      const g = map.get(c.date) || { date: c.date };
      g[c.kind] = c;
      map.set(c.date, g);
    }
    for (const so of data?.signoffs ?? []) {
      const g = map.get(so.date) || { date: so.date };
      g.signoff = so;
      map.set(so.date, g);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [data, date]);

  const toggle = useCallback((d: string) => setOpenDates((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])), []);

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: t.background }}>
      <TopBar t={t} title={member.name} onBack={onBack} />
      <View style={{ flexDirection: 'row', marginBottom: 10, alignItems: 'center' }}>
        <Text style={{ color: t.subtext, marginRight: 10 }}>History up to {date}:</Text>
        {([7, 30] as const).map((n) => (
          <Pressable
            key={n} onPress={() => setSpan(n)}
            style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, marginRight: 6, backgroundColor: span === n ? t.accent : t.card }}
          >
            <Text style={{ color: span === n ? '#fff' : t.text, fontSize: 13 }}>{n} days</Text>
          </Pressable>
        ))}
      </View>
      {!!err && <Text style={{ color: RED, marginBottom: 8 }}>{err}</Text>}
      <FlatList
        data={groups}
        keyExtractor={(g) => g.date}
        extraData={openDates}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[t.accent]} />}
        initialNumToRender={8}
        windowSize={7}
        renderItem={({ item }) => <DayCard g={item} t={t} open={openDates.includes(item.date)} onToggle={toggle} />}
        ListEmptyComponent={data ? null : <ActivityIndicator color={t.accent} />}
      />
    </View>
  );
}

// ---------------- check-in settings ----------------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const DAYS: { d: number; label: string }[] = [
  { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' }, { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
];

export function CheckinSettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [s, setS] = useState<CheckinSettings | null>(null);
  const [morning, setMorning] = useState('');
  const [evening, setEvening] = useState('');
  const [nudge, setNudge] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState('');
  const [isErr, setIsErr] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (x: CheckinSettings) => {
    setS(x); setMorning(x.morningTime); setEvening(x.eveningTime); setNudge(String(x.nudgeMinutes));
    setDays(x.days); setEnabled(x.enabled);
  };
  const load = useCallback(async () => {
    try { apply((await api<{ settings: CheckinSettings }>('GET', '/admin/checkins/settings')).settings); }
    catch (e: any) { setMsg(e.message); setIsErr(true); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const save = async () => {
    const fail = (m: string) => { setMsg(m); setIsErr(true); };
    if (!TIME_RE.test(morning.trim())) return fail('Morning time must be HH:MM (24 hour), e.g. 10:00');
    if (!TIME_RE.test(evening.trim())) return fail('Evening time must be HH:MM (24 hour), e.g. 18:00');
    if (toMin(morning.trim()) >= toMin(evening.trim())) return fail('Morning time must be before evening time');
    const n = Number(nudge.trim());
    if (nudge.trim() === '' || !Number.isInteger(n) || n < 0 || n > 720) return fail('Nudge minutes: whole number 0-720 (0 = no nudge)');
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ settings: CheckinSettings }>('PUT', '/admin/checkins/settings', {
        enabled, morningTime: morning.trim(), eveningTime: evening.trim(), days, nudgeMinutes: n,
      });
      apply(r.settings);
      setMsg('Saved'); setIsErr(false);
    } catch (e: any) { fail(e.message); }
    setBusy(false);
  };

  const input = {
    backgroundColor: t.card, color: t.text, borderColor: t.border, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15, marginBottom: 10,
  } as const;
  const label = { color: t.subtext, fontSize: 13, marginBottom: 4 } as const;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.background }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <TopBar t={t} title="Check-in settings" onBack={onBack} />
      {!s ? (msg ? <Text style={{ color: RED }}>{msg}</Text> : <ActivityIndicator color={t.accent} />) : (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ color: t.text, fontWeight: '600' }}>Daily check-ins enabled</Text>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: t.accent, false: t.border }} thumbColor="#fff" />
          </View>
          <Text style={label}>Morning task card (HH:MM)</Text>
          <TextInput style={input} value={morning} onChangeText={setMorning} placeholder="10:00" placeholderTextColor={t.subtext} maxLength={5} />
          <Text style={label}>Evening sign-off (HH:MM)</Text>
          <TextInput style={input} value={evening} onChangeText={setEvening} placeholder="18:00" placeholderTextColor={t.subtext} maxLength={5} />
          <Text style={label}>Days</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {DAYS.map((x) => {
              const on = days.includes(x.d);
              return (
                <Pressable
                  key={x.d}
                  onPress={() => setDays((cur) => (cur.includes(x.d) ? cur.filter((v) => v !== x.d) : [...cur, x.d].sort((a, b) => a - b)))}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 6, marginBottom: 6, backgroundColor: on ? t.accent : t.card, borderWidth: 1, borderColor: on ? t.accent : t.border }}
                >
                  <Text style={{ color: on ? '#fff' : t.text, fontSize: 13 }}>{x.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={label}>Sign-off reminder after (minutes, 0 = none)</Text>
          <TextInput style={input} value={nudge} onChangeText={setNudge} keyboardType="number-pad" maxLength={3} placeholder="120" placeholderTextColor={t.subtext} />
          <Text style={{ color: t.subtext, fontSize: 12, marginBottom: 10 }}>Time zone: {s.timezone}. Members get phone reminders at these times.</Text>
          {!!msg && <Text style={{ color: isErr ? RED : GREEN, marginBottom: 8 }}>{msg}</Text>}
          <Pressable onPress={save} disabled={busy} style={{ backgroundColor: t.accent, borderRadius: 20, paddingVertical: 10, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>{busy ? '...' : 'Save'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
