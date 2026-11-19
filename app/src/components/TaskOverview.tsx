import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { api } from '../api';
import { ActivityEvent, OVERDUE_COLOR, STATUS_COLOR, STEPS, Summary, Totals, UserCount, labelOf } from '../taskTypes';
import { ago, describeEvent, EVENT_ICON } from '../taskEvents';
import Avatar from './Avatar';

export type TileKey = 'open' | 'coding' | 'testing' | 'doneToday' | 'overdue';

const TILES: { key: TileKey; label: string; color: string; value: (t: Totals) => number }[] = [
  { key: 'open', label: 'Open', color: STATUS_COLOR.todo, value: (t) => t.open },
  { key: 'coding', label: 'Coding', color: STATUS_COLOR.coding, value: (t) => t.coding },
  { key: 'testing', label: 'Testing', color: STATUS_COLOR.testing, value: (t) => t.testing },
  { key: 'doneToday', label: 'Done today', color: STATUS_COLOR.done, value: (t) => t.doneToday },
  { key: 'overdue', label: 'Overdue', color: OVERDUE_COLOR, value: (t) => t.overdue },
];

export default function TaskOverview({ sum, activity, canPraise, onTile, onTeam, onOpenTask, isBoss = true }: {
  sum: Summary | null; activity: ActivityEvent[]; canPraise: boolean;
  onTile: (k: TileKey) => void; onTeam: (userId: number) => void; onOpenTask: (id: number) => void; isBoss?: boolean;
}) {
  const t = useTheme();
  const [praised, setPraised] = useState<Record<number, boolean>>({});
  const totals = sum?.totals;
  const team = (sum?.users ?? []).filter((u) => u.total > 0).sort((a, b) => (b.total - b.done) - (a.total - a.done));
  const heading = { color: t.subtext, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginHorizontal: 20, marginTop: 24, marginBottom: 8 } as const;

  const praise = async (e: ActivityEvent) => {
    try { await api('POST', '/tasks/' + e.taskId + '/praise', {}); setPraised((p) => ({ ...p, [e.id]: true })); }
    catch (er: any) { Alert.alert('Could not praise', er.message); }
  };

  return (
    <View style={{ paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12 }}>
        {TILES.map((x) => {
          const v = totals ? x.value(totals) : 0;
          const hot = x.key === 'overdue' && v > 0;
          return (
            <Pressable key={x.key} onPress={() => onTile(x.key)} style={{ flex: 1, padding: 3 }}>
              <View style={{ backgroundColor: t.card, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 4, minHeight: 72, alignItems: 'center', borderTopWidth: 3, borderTopColor: x.color }}>
                <Text style={{ color: hot ? t.danger : t.text, fontSize: 22, fontWeight: '700' }}>{v}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: t.subtext, fontSize: 11, marginTop: 2 }}>{x.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={heading}>{isBoss ? 'Team' : 'Mera kaam'}</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, overflow: 'hidden' }}>
        {!team.length && <Text style={{ color: t.subtext, padding: 16 }}>No tasks yet.</Text>}
        {team.map((u, i) => (
          <Pressable
            key={u.id} onPress={() => onTeam(u.id)}
            style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: 68, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar name={u.name} id={u.id} userId={u.id} size={36} />
              <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600', marginLeft: 12 }}>{u.name}</Text>
              {u.overdue > 0 && (
                <View style={{ backgroundColor: OVERDUE_COLOR, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{u.overdue} overdue</Text>
                </View>
              )}
              <Text style={{ color: t.subtext, fontSize: 12 }}>{u.done}/{u.total}</Text>
            </View>
            <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.soft, marginTop: 10 }}>
              {STEPS.map((s) => [s, (u as UserCount)[s]] as const).map(([s, n]) =>
                n > 0 ? <View key={s} style={{ flex: n, backgroundColor: STATUS_COLOR[s] }} /> : null)}
            </View>
            <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>
              {STEPS.filter((s) => s !== 'done' && u[s] > 0).map((s) => u[s] + ' ' + labelOf(s).toLowerCase()).join(' · ')}{u.done ? ' · ' + u.done + ' done' : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={heading}>Activity</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 16, marginHorizontal: 16, overflow: 'hidden' }}>
        {!activity.length && <Text style={{ color: t.subtext, padding: 16 }}>No activity yet.</Text>}
        {activity.slice(0, 30).map((e, i) => {
          const done = e.event === 'status' && (e.newValue === 'done' || e.newValue === 'testing' || e.newValue === 'change_merged' || e.newValue === 'review');
          return (
            <Pressable
              key={e.id} onPress={() => onOpenTask(e.taskId)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12, minHeight: 60, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
            >
              <Ionicons name={(EVENT_ICON[e.event] || 'ellipse') as any} size={20} color={t.accent} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: t.text, fontSize: 14 }}>{describeEvent(e, e.actorName || 'Someone')}</Text>
                <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 13, marginTop: 1 }}>{e.taskTitle}</Text>
                {e.event === 'note' && !!e.newValue && (
                  <Text numberOfLines={2} style={{ color: t.text, fontSize: 13, fontStyle: 'italic', marginTop: 2 }}>{'"' + e.newValue + '"'}</Text>
                )}
                {canPraise && done && (
                  <Pressable
                    disabled={!!praised[e.id]} onPress={() => praise(e)}
                    style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: t.accent, marginTop: 8, opacity: praised[e.id] ? 0.5 : 1 }}
                  >
                    <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>{praised[e.id] ? 'Praised' : '👏 Praise'}</Text>
                  </Pressable>
                )}
              </View>
              <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 8 }}>{ago(e.createdAt)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
