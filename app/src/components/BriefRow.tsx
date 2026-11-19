import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../useTheme';
import { BriefTask } from '../taskTypes';
import StatusPill from './StatusPill';

export const BRIEF_H = 72; // same as ROW_H so lists have one fixed row height

// What a member sees of other people's tasks (Everyone filter): title, status, assignee first names. Not tappable.
function BriefRowBase({ task }: { task: BriefTask }) {
  const t = useTheme();
  const names = (task.assigneeNames || []).map((n) => n.trim().split(/\s+/)[0]).join(', ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: BRIEF_H, backgroundColor: t.card, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text numberOfLines={2} style={{ color: t.text, fontSize: 15 }}>{task.title}</Text>
        <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12, marginTop: 3 }}>{names || 'Unassigned'}</Text>
      </View>
      <StatusPill status={task.status} />
    </View>
  );
}
export default React.memo(BriefRowBase, (a, b) => a.task.id === b.task.id && a.task.status === b.task.status && a.task.title === b.task.title && a.task.assigneeNames.join() === b.task.assigneeNames.join());
