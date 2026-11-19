import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../useTheme';
import { STEPS, colorOf, labelOf, Task } from '../taskTypes';
import { formatDue } from '../dates';
import { AvatarStack } from './Avatar';

const Card = React.memo(
  function Card({ task, onPress, onLongPress }: { task: Task; onPress: (id: number) => void; onLongPress?: (t: Task) => void }) {
    const t = useTheme();
    const late = task.overdue && task.status !== 'done';
    return (
      <Pressable
        onPress={() => onPress(task.id)} onLongPress={onLongPress ? () => onLongPress(task) : undefined}
        style={{ backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: late ? t.danger : colorOf(task.status) }}
      >
        <Text numberOfLines={3} style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{task.title}</Text>
        {!!task.project && (
          <View style={{ alignSelf: 'flex-start', backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6 }}>
            <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            {(task.assignees || []).length > 0
              ? <AvatarStack people={task.assignees} size={22} max={3} />
              : <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12 }}>{task.assigneeName || 'Unassigned'}</Text>}
          </View>
          {!!task.dueDate && <Text style={{ color: late ? t.danger : t.subtext, fontSize: 11, fontWeight: late ? '700' : '400' }}>{formatDue(task.dueDate)}</Text>}
        </View>
      </Pressable>
    );
  },
  (a, b) => a.task.id === b.task.id && a.task.updatedAt === b.task.updatedAt && a.task.status === b.task.status && a.onPress === b.onPress && a.onLongPress === b.onLongPress,
);

function Column({ status, list, width, height, onOpen, onLongPress }: {
  status: string; list: Task[]; width: number; height: number; onOpen: (id: number) => void; onLongPress?: (t: Task) => void;
}) {
  const t = useTheme();
  const render = useCallback(({ item }: { item: Task }) => <Card task={item} onPress={onOpen} onLongPress={onLongPress} />, [onOpen, onLongPress]);
  return (
    <View style={{ width, height, marginRight: 12, backgroundColor: t.soft, borderRadius: 16, padding: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(status), marginRight: 8 }} />
        <Text style={{ color: t.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{labelOf(status)}</Text>
        <Text style={{ color: t.subtext, fontSize: 13 }}>{list.length}</Text>
      </View>
      <FlatList
        data={list} keyExtractor={(x) => String(x.id)} renderItem={render}
        nestedScrollEnabled showsVerticalScrollIndicator={false} initialNumToRender={8} windowSize={5}
        removeClippedSubviews={Platform.OS === 'android'}
        ListEmptyComponent={<Text style={{ color: t.subtext, fontSize: 13, textAlign: 'center', padding: 16 }}>Empty</Text>}
      />
    </View>
  );
}

// Horizontal Kanban, one column per step. Tap a card for the detail, long-press for quick actions.
export default function TaskBoard({ tasks, onOpen, onLongPress }: { tasks: Task[]; onOpen: (id: number) => void; onLongPress?: (t: Task) => void }) {
  const { width } = useWindowDimensions();
  const colW = Math.min(280, Math.round(width * 0.78));
  const [h, setH] = useState(0); // columns need a fixed height so each can scroll on its own
  const cols = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const s of STEPS) m[s] = [];
    for (const x of tasks) {
      const st = x.status as string;
      const k = st === 'closed' ? null : st === 'in_progress' ? 'coding' : st === 'review' ? 'testing' : st;
      if (k && m[k]) m[k].push(x);
    }
    m.done = m.done.slice(0, 30);
    return m;
  }, [tasks]);
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }} style={{ flex: 1 }}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
    >
      {STEPS.map((s) => <Column key={s} status={s} list={cols[s]} width={colW} height={Math.max(200, h - 24)} onOpen={onOpen} onLongPress={onLongPress} />)}
    </ScrollView>
  );
}
