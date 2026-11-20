// Daily check-in briefing card (owner request 2026-11-20, C-01..C-04). Rendered for checkin_prompt messages of kind
// 'day' (morning), 'signoff' (evening) and 'summary' (admins). Layout: a header (greeting + date), then one row per task:
// a colour-coded status pill on the left, the title, one action button on the right; then a reply box.
// - Morning: "Today" toggle = "I'll work on this today" (POST /checkins/picks); box "Anything new you'll work on?"
// - Evening: "Done" checkbox = the normal task tick (PATCH /tasks/:id {status, userId: me}; the server applies the
//   assignee-or-admin rule); box "Today's report…"
// - The box posts a normal message in this chat (the server stores it as today's check-in text and runs the usual
//   AI task detection on it).
// - Old days are read-only. The server keeps the payload live (ws 'edited'); local state is only an optimistic overlay.
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { CheckinPromptPayload, CheckinSummaryPayload, DayTask, Msg } from '../chatTypes';
import { api } from '../api';
import { newClientId } from '../outbox';
import { toast } from '../useVoiceInput';

export const PILL = {
  done: { label: 'DONE', color: '#2E9E6B' },
  today: { label: 'TODAY', color: '#6C4CF5' },
  open: { label: 'OPEN', color: '#C98A0B' },
};
export const TEXT = {
  morningTitle: (name?: string) => 'Good morning' + (name ? ', ' + name : ''),
  morningAsk: 'Which of these will you work on today? Or will you do something new?',
  morningEmpty: 'No open tasks. What will you work on today?',
  morningBox: "Anything new you'll work on?",
  eveningTitle: 'Evening check-in',
  eveningAsk: "If any of your tasks got done, tick it. Then tell us how today went.",
  eveningEmpty: 'No tasks on your list. What did you do today?',
  eveningBox: "Today's report…",
  sent: 'Sent',
  notSent: 'Not sent. Check the internet and try again.',
  tickFailed: "Couldn't update the task. Try again.",
  pickFailed: "Couldn't save. Try again.",
};

const localYmd = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export function niceDate(ymd: string) {
  const d = new Date(ymd + 'T12:00:00');
  if (isNaN(d.getTime())) return ymd;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()];
}

function Pill({ kind }: { kind: keyof typeof PILL }) {
  const p = PILL[kind];
  return (
    <View testID={'pill-' + kind} style={{ backgroundColor: p.color + '26', borderColor: p.color, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 54, alignItems: 'center' }}>
      <Text style={{ color: p.color, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{p.label}</Text>
    </View>
  );
}

type Props = {
  msg: Msg;
  t: Theme;
  time: string;
  meId: number | null;
  meName?: string;
  onLongPress?: (m: Msg) => void;
  onOpenTask?: (id: number) => void;
  today?: string; // tests
};

export default function DailyCheckinCard({ msg, t, time, meId, meName, onLongPress, onOpenTask, today }: Props) {
  const p = msg.payload as CheckinPromptPayload | CheckinSummaryPayload;
  const live = p.date === (today || localYmd());
  return (
    <View style={{ paddingHorizontal: 12, marginVertical: 6, alignItems: 'center' }}>
      <Pressable
        onLongPress={() => onLongPress && onLongPress(msg)}
        style={{ width: '100%', maxWidth: 520, backgroundColor: t.card, borderRadius: 16, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}
      >
        {p.kind === 'summary'
          ? <SummaryBody p={p as CheckinSummaryPayload} t={t} time={time} />
          : <TaskBody p={p as CheckinPromptPayload} t={t} time={time} live={live} msg={msg} meId={meId} meName={meName} onOpenTask={onOpenTask} />}
      </Pressable>
    </View>
  );
}

function Header({ t, icon, title, date, time, sub }: { t: Theme; icon: keyof typeof Ionicons.glyphMap; title: string; date: string; time: string; sub?: string }) {
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, backgroundColor: t.soft }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={16} color={t.onAccent} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>{title}</Text>
          <Text style={{ color: t.subtext, fontSize: 12 }}>{niceDate(date)}</Text>
        </View>
        <Text style={{ color: t.subtext, fontSize: 11 }}>{time}</Text>
      </View>
      {!!sub && <Text style={{ color: t.text, fontSize: 13, marginTop: 8 }}>{sub}</Text>}
    </View>
  );
}

function TaskBody({ p, t, time, live, msg, meId, meName, onOpenTask }: {
  p: CheckinPromptPayload; t: Theme; time: string; live: boolean; msg: Msg; meId: number | null; meName?: string; onOpenTask?: (id: number) => void;
}) {
  const morning = p.kind === 'day';
  // optimistic overlay, dropped whenever the server sends a new payload
  const [statusOver, setStatusOver] = useState<Record<number, 'todo' | 'done'>>({});
  const [pickOver, setPickOver] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  useEffect(() => { setStatusOver({}); setPickOver({}); }, [msg.payload]);
  const picks = useMemo(() => new Set((p.picks || []).map(Number)), [p.picks]);
  const statusOf = (x: DayTask) => statusOver[x.id] || (x.status === 'done' ? 'done' : 'todo');
  const pickedOf = (x: DayTask) => (pickOver[x.id] !== undefined ? pickOver[x.id] : picks.has(x.id));

  const tick = async (x: DayTask) => {
    if (!live || busy[x.id] || !meId) return;
    const prev = statusOf(x);
    const next = prev === 'done' ? 'todo' : 'done';
    setStatusOver((o) => ({ ...o, [x.id]: next }));
    setBusy((b) => ({ ...b, [x.id]: true }));
    try {
      await api('PATCH', '/tasks/' + x.id, { status: next, userId: meId });
    } catch (e) {
      setStatusOver((o) => ({ ...o, [x.id]: prev })); // back to what it showed before the tap
      toast(TEXT.tickFailed);
    } finally { setBusy((b) => ({ ...b, [x.id]: false })); }
  };
  const pick = async (x: DayTask) => {
    if (!live || busy[x.id]) return;
    const prev = pickedOf(x);
    const next = !prev;
    setPickOver((o) => ({ ...o, [x.id]: next }));
    setBusy((b) => ({ ...b, [x.id]: true }));
    try {
      await api('POST', '/checkins/picks', { taskId: x.id, today: next });
    } catch (e) {
      setPickOver((o) => ({ ...o, [x.id]: prev }));
      toast(TEXT.pickFailed);
    } finally { setBusy((b) => ({ ...b, [x.id]: false })); }
  };

  const rows = p.tasks || [];
  return (
    <View>
      <Header
        t={t} icon={morning ? 'sunny' : 'moon'} date={p.date} time={time}
        title={morning ? TEXT.morningTitle(meName) : (p.nudge ? 'Reminder · ' : '') + TEXT.eveningTitle}
        sub={rows.length ? (morning ? TEXT.morningAsk : TEXT.eveningAsk) : (morning ? TEXT.morningEmpty : TEXT.eveningEmpty)}
      />
      {rows.map((x, i) => {
        const st = statusOf(x);
        const picked = morning && pickedOf(x);
        const pill: keyof typeof PILL = st === 'done' ? 'done' : picked ? 'today' : 'open';
        return (
          <View key={x.id} testID={'row-' + x.id} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
            <Pill kind={pill} />
            <Pressable onPress={() => onOpenTask && onOpenTask(x.id)} style={{ flex: 1, marginHorizontal: 10 }} accessibilityRole="button">
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, textDecorationLine: st === 'done' ? 'line-through' : 'none', opacity: st === 'done' ? 0.7 : 1 }}>{x.title}</Text>
            </Pressable>
            {live && (morning ? (
              <Pressable
                testID={'today-' + x.id} onPress={() => pick(x)} disabled={st === 'done'} hitSlop={6}
                accessibilityRole="switch" accessibilityState={{ checked: picked }} accessibilityLabel={'Work on ' + x.title + ' today'}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: t.accent, backgroundColor: picked ? t.accent : 'transparent', opacity: st === 'done' ? 0.4 : 1 }}
              >
                <Ionicons name={picked ? 'checkmark' : 'add'} size={14} color={picked ? t.onAccent : t.accent} />
                <Text style={{ color: picked ? t.onAccent : t.accent, fontSize: 12, fontWeight: '700', marginLeft: 3 }}>Today</Text>
              </Pressable>
            ) : (
              <Pressable
                testID={'done-' + x.id} onPress={() => tick(x)} hitSlop={6}
                accessibilityRole="checkbox" accessibilityState={{ checked: st === 'done' }} accessibilityLabel={'Mark ' + x.title + ' done'}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32, paddingHorizontal: 8 }}
              >
                {busy[x.id] ? <ActivityIndicator size="small" color={t.accent} /> : (
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: st === 'done' ? PILL.done.color : t.subtext, backgroundColor: st === 'done' ? PILL.done.color : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {st === 'done' && <Ionicons name="checkmark" size={15} color="#fff" />}
                  </View>
                )}
                <Text style={{ color: t.text, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>Done</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
      {live && <ReplyBox t={t} chatId={msg.chatId} placeholder={morning ? TEXT.morningBox : TEXT.eveningBox} />}
    </View>
  );
}

function ReplyBox({ t, chatId, placeholder }: { t: Theme; chatId: number; placeholder: string }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const send = async () => {
    const body = text.trim();
    if (!body || state === 'sending') return;
    setState('sending');
    try {
      await api('POST', '/chats/' + chatId + '/messages', { text: body, clientId: newClientId() });
      setText('');
      setState('sent');
    } catch (e) {
      setState('idle');
      toast(TEXT.notSent);
    }
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, borderTopWidth: 1, borderTopColor: t.border }}>
      <TextInput
        testID="checkin-reply" value={text} onChangeText={(v) => { setText(v); if (state === 'sent') setState('idle'); }}
        placeholder={state === 'sent' ? TEXT.sent + ' ✓' : placeholder} placeholderTextColor={t.subtext} multiline maxLength={2000}
        style={{ flex: 1, color: t.text, backgroundColor: t.surface, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, maxHeight: 120 }}
      />
      <Pressable
        testID="checkin-send" onPress={send} disabled={!text.trim() || state === 'sending'} accessibilityLabel="Send"
        style={{ marginLeft: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? t.accent : t.border, alignItems: 'center', justifyContent: 'center' }}
      >
        {state === 'sending' ? <ActivityIndicator size="small" color={t.onAccent} /> : <Ionicons name="send" size={18} color={t.onAccent} />}
      </Pressable>
    </View>
  );
}

function SummaryBody({ p, t, time }: { p: CheckinSummaryPayload; t: Theme; time: string }) {
  const tot = p.totals || { members: 0, replied: 0, done: 0, picked: 0 };
  return (
    <View>
      <Header t={t} icon="people" title="Check-in summary" date={p.date} time={time}
        sub={tot.replied + ' of ' + tot.members + ' replied · ' + tot.done + ' done today · ' + tot.picked + ' picked for today'} />
      {(p.members || []).map((m, i) => (
        <View key={m.id} testID={'member-' + m.id} style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ backgroundColor: (m.replied ? PILL.done.color : '#8E9AAF') + '26', borderColor: m.replied ? PILL.done.color : '#8E9AAF', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: m.replied ? PILL.done.color : '#8E9AAF', fontSize: 10, fontWeight: '800' }}>{m.replied ? 'REPLIED' : 'NO REPLY'}</Text>
            </View>
            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: 15, marginLeft: 10 }}>{m.name}</Text>
            <Text style={{ color: t.subtext, fontSize: 12 }}>{m.done.length} done · {m.open} open</Text>
          </View>
          {!!m.picks.length && <Line t={t} label="Today" text={m.picks.map((x) => x.title).join(', ')} />}
          {!!m.done.length && <Line t={t} label="Done" text={m.done.map((x) => x.title).join(', ')} />}
          {!!m.morning && <Line t={t} label="Morning" text={m.morning} />}
          {!!m.report && <Line t={t} label="Report" text={m.report} />}
        </View>
      ))}
    </View>
  );
}

function Line({ t, label, text }: { t: Theme; label: string; text: string }) {
  return (
    <Text style={{ color: t.text, fontSize: 13, marginTop: 4 }} numberOfLines={3}>
      <Text style={{ color: t.subtext, fontWeight: '700' }}>{label}: </Text>{text}
    </Text>
  );
}
