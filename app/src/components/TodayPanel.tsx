import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { AdminDay } from '../chatTypes';
import { OVERDUE_COLOR, STATUS_COLOR, Task, assigneeNamesOf } from '../taskTypes';
import { useLiveRefresh } from '../useLive';
import Avatar from './Avatar';
import MyDay from './MyDay';

const heading = { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginHorizontal: 20, marginTop: 20, marginBottom: 8 } as const;

// Member: "My day" card at the top of the Tasks Overview (same sign-off as the evening check-in card).
export function MyDayPanel() {
  const t = useTheme();
  return (
    <View>
      <Text style={{ ...heading, color: t.subtext }}>My day</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, padding: 14, paddingTop: 6 }}>
        <MyDay />
      </View>
    </View>
  );
}

// Boss: who signed off today (GET /admin/checkins), live on ws 'signoff'.
export function SignoffPanel({ onPerson }: { onPerson: (id: number) => void }) {
  const t = useTheme();
  const [day, setDay] = useState<AdminDay | null>(null);
  const load = useCallback(() => { api<AdminDay>('GET', '/admin/checkins').then(setDay).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ['signoff', 'reset']);
  if (!day || !day.members.length) return null;
  const done = day.members.filter((m) => m.signoff.status === 'submitted').length;
  return (
    <View>
      <Text style={{ ...heading, color: t.subtext }}>Aaj ka sign-off · {done}/{day.members.length}</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, overflow: 'hidden' }}>
        {day.members.map((m, i) => {
          const so = m.signoff.signoff;
          return (
            <Pressable
              key={m.id} onPress={() => onPerson(m.id)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
            >
              <Avatar name={m.name} id={m.id} userId={m.id} size={32} />
              <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 12 }}>{m.name}</Text>
              {so ? (
                <>
                  <Text style={{ color: STATUS_COLOR.done, fontSize: 12, fontWeight: '700', marginRight: 8 }}>{so.counts.done} done</Text>
                  <Text style={{ color: t.subtext, fontSize: 12, marginRight: 8 }}>{so.counts.left} baaki</Text>
                  <Ionicons name="checkmark-circle" size={20} color={STATUS_COLOR.done} />
                </>
              ) : (
                <Text style={{ color: t.subtext, fontSize: 12 }}>Pending</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// "6+ din pending": open tasks older than the reminder setting (boss: everyone's, member: own).
export function StalePanel({ tasks, days, onOpen }: { tasks: Task[]; days: number; onOpen: (id: number) => void }) {
  const t = useTheme();
  if (!tasks.length) return null;
  return (
    <View>
      <Text style={{ ...heading, color: OVERDUE_COLOR }}>{days}+ din pending · {tasks.length}</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, overflow: 'hidden', borderLeftWidth: 3, borderLeftColor: OVERDUE_COLOR }}>
        {tasks.slice(0, 20).map((x, i) => (
          <Pressable
            key={x.id} onPress={() => onOpen(x.id)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 14 }}>{x.title}</Text>
              <Text style={{ color: t.subtext, fontSize: 12, marginTop: 2 }}>{assigneeNamesOf(x).join(', ') || 'Unassigned'}  ·  #{x.id}</Text>
            </View>
            <View style={{ backgroundColor: OVERDUE_COLOR, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{x.ageDays ?? days} din</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
