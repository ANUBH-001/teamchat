import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { CheckinPromptPayload, Msg } from '../chatTypes';
import { useAuth } from '../auth';
import TaskActionSheet from './TaskActionSheet';
import DailyCheckinCard from './DailyCheckinCard';

type Props = {
  msg: Msg;
  t: Theme;
  time: string;
  onMic?: (cb: (said: string) => void) => void; // kept for the Bubble API (old cards had a voice box)
  onLongPress?: (m: Msg) => void;
  onOpenTask?: (id: number) => void;
};

// Team Assistant check-in cards in the Daily Check-in chat: 'day' (morning), 'signoff' (evening) and 'summary' (admins)
// render as DailyCheckinCard (payload kept live by the server via ws 'edited'); old round-1 'morning' / 'evening' prompts
// are shown as plain history.
function CheckinCardBase({ msg, t, time, onLongPress, onOpenTask }: Props) {
  const p = msg.payload as CheckinPromptPayload;
  const { user } = useAuth();
  const [sheetId, setSheetId] = useState<number | null>(null);
  // owner request 2026-11-20: morning / evening / admins' summary use the briefing card (pill + title + button rows)
  if (p.kind === 'day' || p.kind === 'signoff' || p.kind === 'summary') {
    return (
      <>
        <DailyCheckinCard msg={msg} t={t} time={time} meId={user ? user.id : null} meName={user ? user.name : undefined}
          onLongPress={onLongPress} onOpenTask={(id) => setSheetId(id)} />
        {sheetId !== null && <TaskActionSheet visible onClose={() => setSheetId(null)} taskId={sheetId} onOpen={onOpenTask} />}
      </>
    );
  }

  // old round-1 'morning' / 'evening' prompts: plain history
  const body = (
    <View>
      <Text style={{ color: t.text, fontSize: 14 }}>{msg.text}</Text>
      <Text style={{ color: t.subtext, fontSize: 12, fontStyle: 'italic', marginTop: 6 }}>Old check-in ({p.date})</Text>
    </View>
  );
  const title = 'Daily Check-in';
  const icon: keyof typeof Ionicons.glyphMap = 'today';

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
    </View>
  );
}

export default React.memo(CheckinCardBase);
