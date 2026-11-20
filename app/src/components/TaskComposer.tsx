import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { Task } from '../taskTypes';
import { useUsers } from '../userStore';
import { toast } from '../useVoiceInput';

// Keep's "Take a note" bar: collapsed = one line; tap = title, people chips (multi, "Me" = private self task), Save.
// Everyone gets it. Admin picks anyone ("Me" = private). A member is preselected as the only assignee and the
// people picker is hidden unless the admin allowed `membersCanAssign` (the server enforces the same rule).
export default function TaskComposer({ meId, onCreated, isBoss = true, canAssign = true }: { meId: number; onCreated: (task: Task) => void; isBoss?: boolean; canAssign?: boolean }) {
  const showPeople = isBoss || canAssign;
  const t = useTheme();
  const users = useUsers();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<number[]>(isBoss ? [] : [meId]);
  const [busy, setBusy] = useState(false);
  const reset = () => { setOpen(false); setTitle(''); setSel(isBoss ? [] : [meId]); setBusy(false); };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityLabel="Take a task" style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, minHeight: 50, borderRadius: 26, backgroundColor: t.card, paddingHorizontal: 18, elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }}>
        <Text style={{ flex: 1, color: t.subtext, fontSize: 16 }}>Take a task…</Text>
        <Ionicons name="checkbox-outline" size={24} color={t.subtext} />
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
      const r = await api<{ task: Task }>('POST', '/tasks', { title: title.trim(), assigneeIds: sel });
      onCreated(r.task);
      reset();
    } catch (e: any) { toast(e.message || 'Could not create the task'); setBusy(false); }
  };
  return (
    <View style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.accent, padding: 12 }}>
      <TextInput
        value={title} onChangeText={setTitle} autoFocus placeholder="What is the task?" placeholderTextColor={t.subtext} maxLength={255} multiline
        style={{ color: t.text, fontSize: 16, minHeight: 40, paddingVertical: 4 }}
      />
      {showPeople && <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 6 }}>ASSIGN TO</Text>}
      {showPeople && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ordered.map((u) => {
          const on = sel.includes(u.id);
          return (
            <Pressable key={u.id} onPress={() => toggle(u.id)} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, marginRight: 6, marginBottom: 6, backgroundColor: on ? t.chip : t.surface, borderWidth: 1, borderColor: on ? t.accent : 'transparent' }}>
              <Text style={{ color: on ? t.chipText : t.text, fontSize: 13, fontWeight: on ? '700' : '500' }}>{u.id === meId ? (isBoss ? 'Me 🔒' : 'Me') : u.name}</Text>
            </Pressable>
          );
        })}
      </View>}
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
