import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { useUsers } from '../userStore';
import Avatar from './Avatar';
import Sheet from './Sheet';

// Multi-select people (task assignees). "Me (khud)" pinned first. Uses the user store (GET /users?includeSelf=1).
export default function PeoplePickSheet({ visible, onClose, title, meId, initial, onSave, max = 10 }: {
  visible: boolean; onClose: () => void; title: string; meId: number; initial: number[]; onSave: (ids: number[]) => void; max?: number;
}) {
  const t = useTheme();
  const users = useUsers();
  const [sel, setSel] = useState<number[]>(initial);
  const [q, setQ] = useState('');
  useEffect(() => { if (visible) { setSel(initial); setQ(''); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = users.filter((u) => !s || u.name.toLowerCase().includes(s));
    const me = all.find((u) => u.id === meId);
    return me ? [me, ...all.filter((u) => u.id !== meId)] : all;
  }, [users, q, meId]);
  const toggle = (id: number) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= max ? p : [...p, id]));
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 6, backgroundColor: t.soft, borderRadius: 22, paddingHorizontal: 14, minHeight: 44 }}>
        <Ionicons name="search" size={18} color={t.subtext} />
        <TextInput value={q} onChangeText={setQ} placeholder="Naam" placeholderTextColor={t.subtext}
          style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 8 }} />
      </View>
      {list.map((u) => {
        const on = sel.includes(u.id);
        return (
          <Pressable key={u.id} onPress={() => toggle(u.id)} android_ripple={{ color: t.border }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingHorizontal: 20 }}>
            <Avatar name={u.name} id={u.id} userId={u.id} size={36} />
            <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, marginLeft: 12 }}>{u.id === meId ? 'Me (khud)' : u.name}</Text>
            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? t.accent : t.subtext} />
          </Pressable>
        );
      })}
      <Pressable onPress={() => sel.length && onSave(sel)}
        style={{ margin: 16, minHeight: 48, borderRadius: 24, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: sel.length ? 1 : 0.5 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Save ({sel.length})</Text>
      </Pressable>
    </Sheet>
  );
}
