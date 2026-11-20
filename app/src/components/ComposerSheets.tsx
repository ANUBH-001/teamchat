import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { COMMANDS, Command } from '../commands';
import { colorOf, Task } from '../taskTypes';
import Sheet from './Sheet';
import Avatar from './Avatar';

export type PickPerson = { id: number; name: string; phone?: string | null; inChat?: boolean; role?: string };
export const phoneTail = (p?: string | null) => (p ? '...' + String(p).slice(-4) : '');
export const firstName = (n: string) => n.trim().split(/\s+/)[0];

// "/" button: every slash command with icon + hint.
export function CommandSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (c: Command) => void }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title="Commands">
      {COMMANDS.map((c) => (
        <Pressable
          key={c.cmd} onPress={() => onPick(c)} android_ripple={{ color: t.border }}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 20 }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={c.icon} size={20} color={t.accent} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>
              {c.cmd}<Text style={{ color: t.subtext, fontWeight: '400', fontSize: 13 }}>{c.args ? '  ' + c.args : ''}</Text>
            </Text>
            <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12, marginTop: 1 }}>{c.desc}</Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

// People list: avatar, name, phone tail (tells same-name people apart). Chat members first.
// me: pinned first row "Me (khud)" (task / assign / reassign / tasks pickers). multi: checkboxes + "Done" button.
export function PeopleSheet({ visible, onClose, title, people, loading, onPick, me, multi, onPickMany }: {
  visible: boolean; onClose: () => void; title: string; people: PickPerson[]; loading?: boolean; onPick: (p: PickPerson) => void;
  me?: PickPerson | null; multi?: boolean; onPickMany?: (ps: PickPerson[]) => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<PickPerson[]>([]);
  useEffect(() => { if (visible) { setQ(''); setSel([]); } }, [visible]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people.filter((p) => (!me || p.id !== me.id) && (!s || p.name.toLowerCase().includes(s) || String(p.phone || '').includes(s)));
  }, [people, q, me]);
  const showMe = !!me && (!q.trim() || 'me khud'.includes(q.trim().toLowerCase()) || me.name.toLowerCase().includes(q.trim().toLowerCase()));
  const inChat = list.filter((p) => p.inChat);
  const rest = list.filter((p) => !p.inChat);
  const tap = (p: PickPerson) => {
    if (!multi) { onPick(p); return; }
    setSel((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : cur.length >= 10 ? cur : [...cur, p]));
  };
  const row = (p: PickPerson, label?: string) => {
    const on = multi && sel.some((x) => x.id === p.id);
    return (
      <Pressable
        key={p.id} onPress={() => tap(p)} android_ripple={{ color: t.border }}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 20 }}
      >
        <Avatar name={p.name} id={p.id} userId={p.id} size={38} />
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16, marginLeft: 14, fontWeight: label ? '600' : '400' }}>{label || p.name}</Text>
        {p.role === 'boss' && !label && <Text style={{ color: t.accent, fontSize: 11, fontWeight: '700', marginRight: 10 }}>ADMIN</Text>}
        {!label && <Text style={{ color: t.subtext, fontSize: 12 }}>{phoneTail(p.phone)}</Text>}
        {multi && <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? t.accent : t.subtext} style={{ marginLeft: 10 }} />}
      </Pressable>
    );
  };
  const head = (label: string) => (
    <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 }}>{label}</Text>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 6, backgroundColor: t.soft, borderRadius: 22, paddingHorizontal: 14, minHeight: 44 }}>
        <Ionicons name="search" size={18} color={t.subtext} />
        <TextInput
          value={q} onChangeText={setQ} placeholder="Name or phone" placeholderTextColor={t.subtext}
          style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 8, paddingVertical: 8 }}
        />
      </View>
      {multi && (
        <Pressable
          disabled={!sel.length} onPress={() => onPickMany && onPickMany(sel)}
          style={{ marginHorizontal: 16, marginBottom: 6, minHeight: 44, borderRadius: 22, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: sel.length ? 1 : 0.5 }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>
            {sel.length ? 'Done (' + sel.map((x) => (me && x.id === me.id ? 'Me' : firstName(x.name))).join(', ') + ')' : 'Choose people'}
          </Text>
        </Pressable>
      )}
      {loading && !people.length && <ActivityIndicator color={t.accent} style={{ margin: 20 }} />}
      {showMe && me && row(me, 'Me (khud)')}
      {inChat.length > 0 && rest.length > 0 && head('IN THIS CHAT')}
      {inChat.map((p) => row(p))}
      {inChat.length > 0 && rest.length > 0 && head('REST OF THE TEAM')}
      {rest.map((p) => row(p))}
      {!loading && !list.length && !showMe && <Text style={{ color: t.subtext, padding: 20, textAlign: 'center' }}>No one found</Text>}
    </Sheet>
  );
}

export type PersonAction = 'ask' | 'update' | 'done' | 'reassign' | 'desc' | 'task' | 'mention';
const TASK_ACTIONS: { key: PersonAction; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'ask', label: 'Ask for status', icon: 'help-circle-outline' },
  { key: 'update', label: 'Update', icon: 'create-outline' },
  { key: 'done', label: 'Done', icon: 'checkmark-circle-outline' },
  { key: 'reassign', label: 'Reassign', icon: 'swap-horizontal-outline' },
  { key: 'desc', label: 'Description', icon: 'document-text-outline' },
];

// After picking a person: their open tasks (chips) + actions. Task actions need a picked task.
export function PersonSheet({ visible, onClose, person, tasks, onAction }: {
  visible: boolean; onClose: () => void; person: PickPerson | null; tasks: Task[] | null;
  onAction: (a: PersonAction, task: Task | null) => void;
}) {
  const t = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(tasks && tasks.length === 1 ? tasks[0].id : null); }, [tasks, person?.id]);
  if (!person) return null;
  const task = (tasks || []).find((x) => x.id === sel) || null;
  const btn = (key: PersonAction, label: string, icon: keyof typeof Ionicons.glyphMap, needsTask: boolean) => {
    const off = needsTask && !task;
    return (
      <Pressable
        key={key} disabled={off} onPress={() => onAction(key, task)}
        style={{ width: '33.33%', padding: 4, opacity: off ? 0.35 : 1 }}
      >
        <View style={{ minHeight: 64, borderRadius: 14, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Ionicons name={icon} size={22} color={t.accent} />
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 12, marginTop: 4 }}>{label}</Text>
        </View>
      </Pressable>
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 }}>
        <Avatar name={person.name} id={person.id} userId={person.id} size={44} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{person.name}</Text>
          <Text style={{ color: t.subtext, fontSize: 12 }}>{phoneTail(person.phone)}</Text>
        </View>
      </View>
      <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, paddingHorizontal: 20, paddingBottom: 4 }}>
        OPEN TASKS{tasks ? ' (' + tasks.length + ')' : ''}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingBottom: 6 }}>
        {!tasks && <ActivityIndicator color={t.accent} style={{ margin: 8 }} />}
        {tasks && !tasks.length && <Text style={{ color: t.subtext, fontSize: 13, padding: 4 }}>No open tasks</Text>}
        {(tasks || []).map((x) => {
          const on = x.id === sel;
          return (
            <Pressable
              key={x.id} onPress={() => setSel(on ? null : x.id)}
              style={{
                flexDirection: 'row', alignItems: 'center', maxWidth: '100%', minHeight: 36, paddingHorizontal: 12, borderRadius: 18, margin: 4,
                backgroundColor: on ? t.accent : t.card, borderWidth: 1, borderColor: on ? t.accent : t.border,
              }}
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: on ? '#fff' : colorOf(x.status), marginRight: 8 }} />
              <Text numberOfLines={1} style={{ color: on ? '#fff' : t.text, fontSize: 13, flexShrink: 1 }}>{x.title}</Text>
              <Text style={{ color: on ? '#fff' : t.subtext, fontSize: 11, marginLeft: 6 }}>#{x.id}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
        {TASK_ACTIONS.map((a) => btn(a.key, a.label, a.icon, true))}
        {btn('task', 'New task', 'add-circle-outline', false)}
        {btn('mention', 'Mention', 'at-outline', false)}
      </View>
    </Sheet>
  );
}
