import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { api } from '../api';
import { CheckinPromptPayload, CheckinSlot, CheckinTask, CheckinToday, Msg } from '../chatTypes';
import { Status, STATUS_COLOR } from '../taskTypes';
import { loadCheckinToday, onCheckinToday, peekCheckinToday } from '../checkinStore';

type Props = {
  msg: Msg;
  t: Theme;
  time: string;
  onMic?: (cb: (said: string) => void) => void; // starts voice typing into this card's text box (dev build only)
};

const EVENING_CHOICES: { s: Status; label: string }[] = [
  { s: 'done', label: 'Done' }, { s: 'in_progress', label: 'In progress' }, { s: 'todo', label: 'Pending' },
];

function Pick({ label, on, color, onPress, t }: { label: string; on: boolean; color: string; onPress: () => void; t: Theme }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, marginRight: 6, marginTop: 4,
        backgroundColor: on ? color : 'transparent', borderWidth: 1, borderColor: on ? color : t.border,
      }}
    >
      <Text style={{ color: on ? '#fff' : t.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

// Team Assistant check-in prompt: morning plan chips or evening work report. Submits POST /checkins.
function CheckinCardBase({ msg, t, time, onMic }: Props) {
  const p = msg.payload as CheckinPromptPayload;
  const kind = p.kind;
  const [today, setToday] = useState<CheckinToday | null>(peekCheckinToday());
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inited = useRef(false);

  const isToday = !!today && today.date === p.date;
  const slot: CheckinSlot | null = today ? today[kind] : null;
  const tasks: CheckinTask[] = today ? (kind === 'morning' ? today.tasks : today.eveningTasks) : p.tasks || [];

  // fill the form from the server state (existing submission, else current task statuses)
  const fill = useCallback((d: CheckinToday) => {
    const c = d[kind].checkin;
    const list = kind === 'morning' ? d.tasks : d.eveningTasks;
    setText(c?.text || '');
    setPicked(c ? c.selectedTaskIds : []);
    const st: Record<number, Status> = {};
    for (const tk of list) st[tk.id] = (c && c.taskStatuses[String(tk.id)]) || tk.status;
    setStatuses(st);
  }, [kind]);

  useEffect(() => {
    let alive = true;
    const apply = (d: CheckinToday) => {
      if (!alive) return;
      setToday(d);
      setFailed(false);
      if (!inited.current && d.date === p.date) {
        inited.current = true;
        setEditing(!d[kind].submitted);
        fill(d);
      }
    };
    const off = onCheckinToday(apply);
    loadCheckinToday().then(apply).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; off(); };
  }, [p.date, kind, fill]);

  const toggle = (id: number) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const body: any = { kind };
      const tx = text.trim();
      if (tx) body.text = tx;
      if (kind === 'morning') body.selectedTaskIds = picked;
      else body.taskStatuses = Object.fromEntries(tasks.map((tk) => [String(tk.id), statuses[tk.id] || tk.status]));
      await api('POST', '/checkins', body);
      const d = await loadCheckinToday(true);
      fill(d);
      setEditing(false);
    } catch (e: any) {
      setErr(e.message || 'Could not send');
    }
    setBusy(false);
  };

  const reopen = () => { if (today) fill(today); setErr(''); setEditing(true); };

  let body: React.ReactNode;
  if (!today && !failed) {
    body = <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start', marginVertical: 6 }} />;
  } else if (!today) {
    body = <Text style={{ color: t.subtext, fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>Could not load. Check connection.</Text>;
  } else if (!isToday) {
    body = <Text style={{ color: t.subtext, fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>Purana check-in ({p.date})</Text>;
  } else if (!editing && slot && slot.submitted) {
    body = (
      <View style={{ marginTop: 6 }}>
        <Text style={{ color: t.accent, fontWeight: '700', fontSize: 14 }}>{'Submitted ✓'}</Text>
        <Pressable onPress={reopen} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
          <Text style={{ color: t.primary, fontWeight: '600', fontSize: 13 }}>Edit</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <View style={{ marginTop: 6 }}>
        {tasks.length > 0 && (
          <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>
            {kind === 'morning' ? 'Aaj ye karunga (tap to select)' : 'Tasks ka status'}
          </Text>
        )}
        {kind === 'morning' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {tasks.map((tk) => (
              <Pick key={tk.id} label={tk.title} on={picked.includes(tk.id)} color={t.accent} t={t} onPress={() => toggle(tk.id)} />
            ))}
          </View>
        ) : (
          tasks.map((tk) => (
            <View key={tk.id} style={{ marginTop: 6 }}>
              <Text style={{ color: t.text, fontSize: 14 }}>{tk.title}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {EVENING_CHOICES.map((c) => (
                  <Pick
                    key={c.s} label={c.label} on={(statuses[tk.id] || tk.status) === c.s} color={STATUS_COLOR[c.s]} t={t}
                    onPress={() => setStatuses((cur) => ({ ...cur, [tk.id]: c.s }))}
                  />
                ))}
              </View>
            </View>
          ))
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder={kind === 'morning' ? 'Aaj ka plan (optional)' : 'kya kiya, kya pending, koi dikkat?'}
            placeholderTextColor={t.subtext}
            style={{
              flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: t.background, color: t.text, borderRadius: 10,
              paddingHorizontal: 10, paddingVertical: 6, fontSize: 14,
            }}
          />
          {!!onMic && (
            <Pressable
              onPress={() => onMic((said) => setText((cur) => (cur ? cur + ' ' + said : said)))}
              accessibilityLabel="Voice input"
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
            >
              <Ionicons name="mic" size={20} color="#fff" />
            </Pressable>
          )}
        </View>
        {!!err && <Text style={{ color: '#D32F2F', fontSize: 13, marginTop: 6 }}>{err}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Pressable
            onPress={submit}
            disabled={busy}
            style={{ backgroundColor: t.accent, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8, opacity: busy ? 0.6 : 1 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {busy ? '...' : kind === 'morning' ? 'Send plan' : 'Send report'}
            </Text>
          </Pressable>
          {!!slot && slot.submitted && (
            <Pressable onPress={() => { setEditing(false); setErr(''); }} hitSlop={6} style={{ marginLeft: 14 }}>
              <Text style={{ color: t.subtext, fontSize: 13 }}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 10, marginVertical: 2, alignItems: 'flex-start' }}>
      <View
        style={{
          width: '92%', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: t.bubbleIn,
          borderLeftWidth: 3, borderLeftColor: t.accent,
        }}
      >
        <Text style={{ color: t.accent, fontWeight: '700', fontSize: 13, marginBottom: 3 }}>
          {kind === 'morning' ? 'Morning plan' : 'Evening report'}{p.nudge ? ' (reminder)' : ''}
        </Text>
        <Text style={{ color: t.text, fontSize: 15 }}>
          {kind === 'morning' ? 'Good morning! Aaj ka plan batao.' : 'Din kaisa raha? Apna work report bhejo.'}
        </Text>
        {body}
        <Text style={{ color: t.subtext, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 }}>{time}</Text>
      </View>
    </View>
  );
}

export default React.memo(CheckinCardBase);
