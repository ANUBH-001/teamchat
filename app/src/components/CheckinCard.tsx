import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { CheckinPromptPayload, Msg } from '../chatTypes';
import { colorOf, labelOf } from '../taskTypes';
import { useAuth } from '../auth';
import TaskActionSheet from './TaskActionSheet';
import TaskModal from './TaskModal';
import MyDay, { Counts, Flags } from './MyDay';

type Props = {
  msg: Msg;
  t: Theme;
  time: string;
  onMic?: (cb: (said: string) => void) => void; // kept for the Bubble API (old cards had a voice box)
  onLongPress?: (m: Msg) => void;
  onOpenTask?: (id: number) => void;
};

// Team Assistant check-in cards in the member's Daily Check-in chat:
// 'day' = morning list of all open tasks (pinned, payload updated live by the server via ws 'edited');
// 'signoff' = evening sign-off (today's tasks, 3-state toggles, Submit) - live form for today, read-only summary for old days;
// 'morning' / 'evening' = old round-1 prompts: shown as plain history.
function CheckinCardBase({ msg, t, time, onLongPress, onOpenTask }: Props) {
  const p = msg.payload as CheckinPromptPayload;
  const { user } = useAuth();
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const today = new Date();
  const ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const isToday = p.date === ymd;

  let title = 'Daily Check-in';
  let icon: keyof typeof Ionicons.glyphMap = 'today';
  let body: React.ReactNode;
  if (p.kind === 'day') {
    title = "Today's tasks · " + p.tasks.length;
    icon = 'sunny';
    body = (
      <View>
        {!p.tasks.length && <Text style={{ color: t.subtext, fontSize: 14, marginTop: 6 }}>No open tasks. Great job!</Text>}
        {p.tasks.map((x, i) => (
          <Pressable
            key={x.id} onPress={() => setSheetId(x.id)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorOf(x.status), marginTop: 5, marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 15 }}>{x.title}</Text>
              <Flags task={x} />
            </View>
            <Text style={{ color: colorOf(x.status), fontSize: 11, fontWeight: '700', marginLeft: 8, marginTop: 3 }}>{labelOf(x.status)}</Text>
          </Pressable>
        ))}
        {isToday && user?.role === 'boss' && (
          <Pressable onPress={() => setCreating(true)} style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: t.accent, marginTop: 8 }}>
            <Text style={{ color: t.accent, fontWeight: '600', fontSize: 13 }}>+ New task</Text>
          </Pressable>
        )}
      </View>
    );
  } else if (p.kind === 'signoff') {
    title = (p.nudge ? 'Reminder · ' : '') + 'Evening sign-off';
    icon = 'moon';
    body = isToday ? <MyDay compact /> : (
      <View>
        {!!p.counts && <Counts c={p.counts} />}
        <Text style={{ color: t.subtext, fontSize: 12, fontStyle: 'italic', marginTop: 8 }}>Old sign-off ({p.date})</Text>
      </View>
    );
  } else {
    body = (
      <View>
        <Text style={{ color: t.text, fontSize: 14 }}>{msg.text}</Text>
        <Text style={{ color: t.subtext, fontSize: 12, fontStyle: 'italic', marginTop: 6 }}>Old check-in ({p.date})</Text>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 12, marginVertical: 5, alignItems: 'center' }}>
      <Pressable
        onLongPress={() => onLongPress && onLongPress(msg)}
        style={{ width: '100%', maxWidth: 440, backgroundColor: t.card, borderRadius: 16, overflow: 'hidden', elevation: 1 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: t.soft }}>
          <Ionicons name={icon} size={18} color={t.accent} />
          <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: 15, marginLeft: 8 }}>{title}</Text>
          <Text style={{ color: t.subtext, fontSize: 11 }}>{time}</Text>
        </View>
        <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 }}>{body}</View>
      </Pressable>
      {sheetId !== null && <TaskActionSheet visible onClose={() => setSheetId(null)} taskId={sheetId} onOpen={onOpenTask} />}
      {user && <TaskModal visible={creating} meId={user.id} onClose={() => setCreating(false)} onDone={() => {}} />}
    </View>
  );
}

export default React.memo(CheckinCardBase);
