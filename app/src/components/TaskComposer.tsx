import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { Task } from '../taskTypes';
import { useUsers } from '../userStore';
import { isoDay } from '../dates';
import { dayMonth, h12 } from '../taskFormat';
import { toast } from '../useVoiceInput';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Inline day picker (next 3 weeks as chips, no native deps). The server stores the day only (no time of day).
export function DayList({ value, onPick, allowNone }: { value: string | null; onPick: (ymd: string | null) => void; allowNone?: boolean }) {
  const t = useTheme();
  const days = Array.from({ length: 21 }, (_, i) => {
    const ymd = isoDay(i);
    const d = new Date(Date.now() + i * 86400000);
    return { ymd, label: (i === 0 ? 'Aaj' : i === 1 ? 'Kal' : DOW[d.getDay()]) + ' ' + d.getDate() };
  });
  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} style={{ minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 19, marginRight: 6, marginBottom: 6, backgroundColor: on ? t.accent : t.surface }}>
      <Text style={{ color: on ? t.onAccent : t.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {allowNone && chip('none', 'No date', value === null, () => onPick(null))}
      {days.map((d) => chip(d.ymd, d.label, value === d.ymd, () => onPick(d.ymd)))}
    </View>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
// Optional time of day as 'HH:mm' (null = no time): quick chips (Subah 10, Dopahar 2, Shaam 6) or custom hour + minute (00/15/30/45) + am/pm.
export function TimePick({ value, onChange }: { value: string | null; onChange: (hhmm: string | null) => void }) {
  const t = useTheme();
  const [custom, setCustom] = useState(false);
  const h24 = value ? +value.slice(0, 2) : 10;
  const mi = value ? +value.slice(3, 5) : 0;
  const pm = h24 >= 12;
  const h = (h24 % 12) || 12;
  const set = (hh12: number, mm: number, isPm: boolean) => onChange(pad2((hh12 % 12) + (isPm ? 12 : 0)) + ':' + pad2(mm));
  const chip = (key: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, marginRight: 6, marginBottom: 6, backgroundColor: on ? t.accent : t.surface }}>
      <Text style={{ color: on ? t.onAccent : t.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  const step = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={6} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {chip('none', 'No time', !value && !custom, () => { setCustom(false); onChange(null); })}
        {chip('s10', 'Subah 10', value === '10:00', () => { setCustom(false); onChange('10:00'); })}
        {chip('d2', 'Dopahar 2', value === '14:00', () => { setCustom(false); onChange('14:00'); })}
        {chip('s6', 'Shaam 6', value === '18:00', () => { setCustom(false); onChange('18:00'); })}
        {chip('c', value && !['10:00', '14:00', '18:00'].includes(value) ? h12(value) : 'Custom', custom || (!!value && !['10:00', '14:00', '18:00'].includes(value)), () => { setCustom(true); if (!value) onChange('10:00'); })}
      </View>
      {custom && (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          {step('-', () => set(h === 1 ? 12 : h - 1, mi, pm))}
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', width: 36, textAlign: 'center' }}>{h}</Text>
          {step('+', () => set(h === 12 ? 1 : h + 1, mi, pm))}
          <Text style={{ color: t.text, fontSize: 18, marginHorizontal: 6 }}>:</Text>
          {[0, 15, 30, 45].map((m) => (
            <Pressable key={m} onPress={() => set(h, m, pm)} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 18, marginRight: 4, backgroundColor: mi === m ? t.accent : t.surface }}>
              <Text style={{ color: mi === m ? t.onAccent : t.text, fontSize: 13, fontWeight: '600' }}>{pad2(m)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => set(h, mi, !pm)} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, marginLeft: 4, backgroundColor: t.chip }}>
            <Text style={{ color: t.chipText, fontSize: 13, fontWeight: '700' }}>{pm ? 'pm' : 'am'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Keep's "Take a note" bar: collapsed = one line; tap = title, people chips (multi, "Me (khud)" = private self task), due, Save.
export default function TaskComposer({ meId, onCreated }: { meId: number; onCreated: (task: Task) => void }) {
  const t = useTheme();
  const users = useUsers();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [due, setDue] = useState<string | null>(null);
  const [pickDate, setPickDate] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setOpen(false); setTitle(''); setSel([]); setDue(null); setTime(null); setPickDate(false); setBusy(false); };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, minHeight: 48, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14 }}>
        <Text style={{ flex: 1, color: t.subtext, fontSize: 15 }}>Take a task…</Text>
        <Ionicons name="add-circle-outline" size={22} color={t.accent} />
      </Pressable>
    );
  }
  const ordered = [...users.filter((u) => u.id === meId), ...users.filter((u) => u.id !== meId)];
  const toggle = (id: number) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));
  const can = !!title.trim() && sel.length > 0 && !busy;
  const save = async () => {
    if (!can) return;
    setBusy(true);
    try {
      const r = await api<{ task: Task }>('POST', '/tasks', { title: title.trim(), assigneeIds: sel, dueDate: due ? (time ? due + ' ' + time : due) : null });
      onCreated(r.task);
      reset();
    } catch (e: any) { toast(e.message || 'Task nahi bana'); setBusy(false); }
  };
  const dueChip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, marginRight: 6, backgroundColor: on ? t.accent : t.surface }}>
      <Text style={{ color: on ? t.onAccent : t.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.accent, padding: 12 }}>
      <TextInput
        value={title} onChangeText={setTitle} autoFocus placeholder="Task kya hai?" placeholderTextColor={t.subtext} maxLength={255} multiline
        style={{ color: t.text, fontSize: 16, minHeight: 40, paddingVertical: 4 }}
      />
      <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>KISKO</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ordered.map((u) => {
          const on = sel.includes(u.id);
          return (
            <Pressable key={u.id} onPress={() => toggle(u.id)} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, marginRight: 6, marginBottom: 6, backgroundColor: on ? t.chip : t.surface, borderWidth: 1, borderColor: on ? t.accent : 'transparent' }}>
              <Text style={{ color: on ? t.chipText : t.text, fontSize: 13, fontWeight: on ? '700' : '500' }}>{u.id === meId ? 'Me (khud) 🔒' : u.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 6 }}>DUE</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {dueChip('Aaj', due === isoDay(0), () => setDue(due === isoDay(0) ? null : isoDay(0)))}
        {dueChip('Kal', due === isoDay(1), () => setDue(due === isoDay(1) ? null : isoDay(1)))}
        {dueChip(due && due !== isoDay(0) && due !== isoDay(1) ? dayMonth(due) : 'Date chuno', !!due && due !== isoDay(0) && due !== isoDay(1), () => setPickDate((v) => !v))}
      </View>
      {pickDate && <View style={{ marginTop: 8 }}><DayList value={due} onPick={(d) => { setDue(d); setPickDate(false); }} allowNone /></View>}
      <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>TIME (optional)</Text>
      <TimePick value={time} onChange={(v) => { setTime(v); if (v && !due) setDue(isoDay(0)); }} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
        <Pressable onPress={reset} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 16 }}>
          <Text style={{ color: t.subtext, fontWeight: '600' }}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={!can} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 20, borderRadius: 20, backgroundColor: t.accent, opacity: can ? 1 : 0.5 }}>
          <Text style={{ color: t.onAccent, fontWeight: '700' }}>{busy ? '...' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
