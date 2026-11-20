import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { Task } from '../taskTypes';
import { isoDay, nextDow } from '../dates';
import { useUsers } from '../userStore';
import { usePublicSettings } from '../publicSettings';
import Chip from './Chip';

// Create a task for one or more people (multi-select chips, "Me" first). Boss, or members while "members can assign"
// is on; with it off a member can still make a task for himself only (server re-checks).
// people: optional list (old callers pass the summary rows); default = everyone from the user store.
export default function TaskModal({ visible, people, meId, onClose, onDone, initialAssigneeIds, chatId, title: heading }: {
  visible: boolean; people?: { id: number; name: string }[]; meId: number; onClose: () => void; onDone: (task?: Task) => void;
  initialAssigneeIds?: number[]; chatId?: number | null; title?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const ps = usePublicSettings();
  const store = useUsers();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [project, setProject] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [due, setDue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(''); setDesc(''); setProject(''); setSel(initialAssigneeIds && initialAssigneeIds.length ? initialAssigneeIds : [meId]);
    setDue(''); setErr(''); setBusy(false);
  }, [visible, meId]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const base = (people && people.length ? people : store).map((p) => ({ id: p.id, name: p.name }));
    const me = base.find((p) => p.id === meId) || { id: meId, name: 'Me' };
    return [me, ...base.filter((p) => p.id !== meId)];
  }, [people, store, meId]);
  const toggle = (id: number) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 10 ? p : [...p, id]));

  const save = async () => {
    if (!title.trim() || busy || !sel.length) return;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due.trim())) { setErr('Due date: use YYYY-MM-DD'); return; }
    setBusy(true);
    try {
      const r = await api<{ task: Task }>('POST', '/tasks', {
        title: title.trim(), description: desc.trim() || null, project: project.trim() || null, assigneeIds: sel,
        dueDate: due.trim() || null, ...(chatId ? { chatId } : {}),
      });
      onDone(r.task); onClose();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const input = { backgroundColor: t.soft, color: t.text, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 15, marginBottom: 12 } as const;
  const label = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 } as const;
  // Round 4: disabled (admin only create): const onlySelf = !ps.membersCanAssign;
  const onlySelf = false;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <ScrollView
          style={{ maxHeight: '90%', backgroundColor: t.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 16 }}>{heading || 'Naya task'}</Text>
          <TextInput style={input} value={title} onChangeText={setTitle} placeholder="Kya karna hai?" placeholderTextColor={t.subtext} maxLength={255} />
          <TextInput style={[input, { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' }]} value={desc} onChangeText={setDesc} multiline
            placeholder="Description (optional)" placeholderTextColor={t.subtext} maxLength={4000} />
          <TextInput style={input} value={project} onChangeText={setProject} placeholder="Project (optional)" placeholderTextColor={t.subtext} maxLength={60} />
          <Text style={label}>Kisko ({sel.length})</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {list.map((p) => <Chip key={p.id} label={p.id === meId ? 'Me (khud)' : p.name} active={sel.includes(p.id)} onPress={() => toggle(p.id)} />)}
          </View>
          {onlySelf && <Text style={{ color: t.subtext, fontSize: 12, marginBottom: 8 }}>Members abhi sirf apne liye task bana sakte hain (Admin Settings).</Text>}
          <Text style={label}>Due</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="Aaj" active={due === isoDay(0)} onPress={() => setDue(isoDay(0))} />
            <Chip label="Kal" active={due === isoDay(1)} onPress={() => setDue(isoDay(1))} />
            <Chip label="Fri" active={due === nextDow(5)} onPress={() => setDue(nextDow(5))} />
            <Chip label="Next week" active={due === isoDay(7)} onPress={() => setDue(isoDay(7))} />
            <Chip label="None" active={!due} onPress={() => setDue('')} />
          </View>
          <TextInput style={[input, { marginTop: 8 }]} value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" placeholderTextColor={t.subtext} />
          {!!err && <Text style={{ color: t.danger, marginBottom: 8 }}>{err}</Text>}
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Pressable onPress={onClose} style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: t.soft, marginRight: 8 }}>
              <Text style={{ color: t.text, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={save} style={{ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, opacity: title.trim() && sel.length && !busy ? 1 : 0.5 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? '...' : 'Create'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
