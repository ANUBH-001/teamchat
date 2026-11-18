import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { api } from '../api';
import { Msg, BotPayload, TaskEventName } from '../chatTypes';
import { STATUS_COLOR, OVERDUE_COLOR, Task } from '../taskTypes';
import { usePublicSettings } from '../publicSettings';
import { formatDue } from '../dates';
import StatusPill from './StatusPill';
import Avatar from './Avatar';

type IconName = keyof typeof Ionicons.glyphMap;
const EVENT: Record<TaskEventName, { icon: IconName; color: string }> = {
  created: { icon: 'add-circle', color: '#F5A623' },
  updated: { icon: 'refresh-circle', color: '#34B7F1' },
  completed: { icon: 'checkmark-circle', color: '#25D366' },
  review: { icon: 'flask', color: '#A970FF' },
  reassigned: { icon: 'swap-horizontal', color: '#34B7F1' },
  due: { icon: 'calendar', color: '#F5A623' },
  deleted: { icon: 'trash', color: '#E5484D' },
  note: { icon: 'chatbubble-ellipses', color: '#34B7F1' },
  praise: { icon: 'heart', color: '#E5484D' },
};

function headline(ev: TaskEventName, actor: string, t: Task) {
  switch (ev) {
    case 'created': return actor + ' assigned a task' + (t.assigneeName ? ' to ' + t.assigneeName : '');
    case 'completed': return actor + ' completed a task';
    case 'review': return actor + ' moved a task to Testing';
    case 'reassigned': return actor + ' reassigned a task' + (t.assigneeName ? ' to ' + t.assigneeName : '');
    case 'due': return actor + ' changed the due date';
    case 'deleted': return actor + ' deleted a task';
    case 'note': return actor + ' added a note';
    case 'praise': return actor + ' praised ' + (t.assigneeName || 'the work');
    default: return actor + ' updated a task';
  }
}

const eventOf = (p: Extract<BotPayload, { kind: 'task' }>): TaskEventName => p.event ?? p.action ?? 'updated';

type Props = {
  msg: Msg; t: Theme; meId: number; isBoss: boolean; time: string;
  onLongPress: (m: Msg) => void; onOpenTask: (id: number) => void; onSendText: (text: string, mentionIds?: number[]) => void;
  onPrefill?: (text: string) => void;
};

const firstName = (n: string) => n.trim().split(/\s+/)[0];

// Compact task line used by the ask / reminder cards.
function TaskLine({ task, t }: { task: Task; t: Theme }) {
  return (
    <View>
      <Text numberOfLines={3} style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 4 }}>{task.title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
        {!!task.project && (
          <View style={{ backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
            <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
          </View>
        )}
        <StatusPill status={task.status} />
        <Text style={{ color: task.overdue && task.status !== 'done' ? t.danger : t.subtext, fontSize: 12, marginLeft: 8 }}>
          {task.assigneeName || 'Unassigned'}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}  ·  #{task.id}
        </Text>
      </View>
    </View>
  );
}

function Frame({ t, color, msg, time, onLongPress, children }: {
  t: Theme; color: string; msg: Msg; time: string; onLongPress: (m: Msg) => void; children: React.ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: 16, marginVertical: 5, alignItems: 'center' }}>
      <Pressable
        onLongPress={() => onLongPress(msg)}
        style={{ width: '100%', maxWidth: 420, flexDirection: 'row', backgroundColor: t.card, borderRadius: 14, overflow: 'hidden', elevation: 1 }}
      >
        <View style={{ width: 4, backgroundColor: color }} />
        <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 }}>
          {children}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 }}>
            {msg.visibleTo != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Ionicons name="eye-off-outline" size={12} color={t.subtext} />
                <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 4 }}>Only visible to you</Text>
              </View>
            )}
            <Text style={{ color: t.subtext, fontSize: 11 }}>{time}</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function Action({ label, onPress, t, color, disabled }: { label: string; onPress: () => void; t: Theme; color?: string; disabled?: boolean }) {
  const c = color ?? t.accent;
  return (
    <Pressable
      onPress={onPress} disabled={disabled}
      style={{ height: 32, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c, marginRight: 8, marginTop: 6, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: c, fontWeight: '600', fontSize: 13, includeFontPadding: false }}>{label}</Text>
    </Pressable>
  );
}

function BotCardBase({ msg, t, meId, isBoss, time, onLongPress, onOpenTask, onSendText, onPrefill }: Props) {
  const ps = usePublicSettings();
  const [undone, setUndone] = useState(false);
  const [praised, setPraised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const p = msg.payload as BotPayload | null | undefined;
  const frame = (color: string, body: React.ReactNode) => (
    <Frame t={t} color={color} msg={msg} time={time} onLongPress={onLongPress}>{body}</Frame>
  );

  if (msg.deleted) {
    return frame(t.border, <Text style={{ color: t.subtext, fontStyle: 'italic', fontSize: 14 }}>This message was deleted</Text>);
  }

  const guard = async (fn: () => Promise<any>, ok: () => void) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); ok(); } catch (e: any) { Alert.alert('Could not do that', e.message); }
    setBusy(false);
  };

  if (p && p.kind === 'task') {
    const ev = eventOf(p);
    const meta = EVENT[ev] ?? EVENT.updated;
    const task = p.task;
    const gone = ev === 'deleted';
    const creator = task.createdBy === meId;
    const canUndo = !undone && !gone && ev !== 'praise' && ev !== 'note' &&
      (ev === 'created' ? isBoss || creator : isBoss || task.assigneeId === meId);
    const canPraise = !praised && !gone && ps.praiseEnabled && (ev === 'completed' || ev === 'review') && (isBoss || creator) && task.assigneeId !== meId;
    return frame(meta.color, (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name={meta.icon} size={16} color={meta.color} />
          <Text numberOfLines={2} style={{ flex: 1, color: t.subtext, fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
            {headline(ev, p.actorName || 'Someone', task)}
          </Text>
          {!!p.byAi && (
            <Text style={{ color: t.subtext, fontSize: 10, fontWeight: '700', borderWidth: 1, borderColor: t.border, borderRadius: 6, paddingHorizontal: 5, marginLeft: 6 }}>AI</Text>
          )}
        </View>
        <Text numberOfLines={3} style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 4, textDecorationLine: gone ? 'line-through' : 'none' }}>
          {task.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          {!!task.project && (
            <View style={{ backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
              <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
            </View>
          )}
          {!gone && <StatusPill status={task.status} />}
          <Text style={{ color: task.overdue && task.status !== 'done' ? t.danger : t.subtext, fontSize: 12, marginLeft: 8 }}>
            {task.assigneeName || 'Unassigned'}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}
          </Text>
        </View>
        {!!p.note && (
          <Text style={{ color: t.text, fontSize: 13, fontStyle: 'italic', marginTop: 6 }} numberOfLines={4}>{'"' + p.note + '"'}</Text>
        )}
        {undone && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>Undone</Text>}
        {(!gone || canUndo || canPraise) && (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {!gone && <Action t={t} label="Open" onPress={() => onOpenTask(task.id)} />}
            {canUndo && (
              <Action
                t={t} label={busy ? '...' : 'Undo'} color={t.subtext} disabled={busy}
                onPress={() => guard(
                  () => (ev === 'created' ? api('DELETE', '/tasks/' + task.id) : api('POST', '/tasks/' + task.id + '/undo')),
                  () => setUndone(true),
                )}
              />
            )}
            {canPraise && (
              <Action t={t} label={'👏 Praise'} disabled={busy}
                onPress={() => guard(() => api('POST', '/tasks/' + task.id + '/praise', {}), () => setPraised(true))} />
            )}
            {praised && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 6 }}>Praised</Text>}
          </View>
        )}
      </View>
    ));
  }

  if (p && p.kind === 'picker') {
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14 }}>{p.text}</Text>
        {p.tasks.map((x) => (
          <Pressable
            key={x.id}
            disabled={picked !== null}
            onPress={() => { setPicked(x.id); onSendText('/' + p.command.replace(/^\//, '') + ' #' + x.id + (p.arg ? ' ' + p.arg : '')); }}
            style={{
              flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 8, paddingHorizontal: 12, borderRadius: 12,
              backgroundColor: t.soft, opacity: picked !== null && picked !== x.id ? 0.4 : 1,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: STATUS_COLOR[x.status] ?? t.subtext, marginRight: 10 }} />
            <Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 14 }}>{x.title}</Text>
            <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 8 }}>#{x.id}</Text>
          </Pressable>
        ))}
      </View>
    ));
  }

  if (p && p.kind === 'userpicker') {
    // tap = re-send the command for exactly this person (structured mention id; works for same-name people)
    const resend = (u: { id: number; name: string }) =>
      '/' + p.command.replace(/^\//, '') + (p.pre ? ' ' + p.pre : '') + ' @' + firstName(u.name) + (p.arg ? ' ' + p.arg : '');
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14 }}>{p.text}</Text>
        {p.users.map((u) => (
          <Pressable
            key={u.id}
            disabled={picked !== null}
            onPress={() => { setPicked(u.id); onSendText(resend(u), [u.id]); }}
            style={{
              flexDirection: 'row', alignItems: 'center', minHeight: 48, marginTop: 8, paddingHorizontal: 10, borderRadius: 12,
              backgroundColor: t.soft, opacity: picked !== null && picked !== u.id ? 0.4 : 1,
            }}
          >
            <Avatar name={u.name} id={u.id} size={30} />
            <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 10 }}>{u.name}</Text>
            {!!u.phoneTail && <Text style={{ color: t.subtext, fontSize: 12 }}>...{u.phoneTail}</Text>}
          </Pressable>
        ))}
      </View>
    ));
  }

  if (p && p.kind === 'ask') {
    const mineTask = p.task.assigneeId === meId;
    return frame('#34B7F1', (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="help-circle" size={16} color="#34B7F1" />
          <Text numberOfLines={2} style={{ flex: 1, color: t.subtext, fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
            {(p.actorName || 'Someone') + ' ne status poocha' + (p.task.assigneeName ? ' · ' + p.task.assigneeName : '')}
          </Text>
        </View>
        <TaskLine task={p.task} t={t} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Action t={t} label="Open" onPress={() => onOpenTask(p.task.id)} />
          {mineTask && !!onPrefill && <Action t={t} label="Update" onPress={() => onPrefill('/update #' + p.task.id + ' ')} />}
          {mineTask && <Action t={t} label="Done" onPress={() => onSendText('/done #' + p.task.id)} />}
        </View>
        {mineTask && <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>Is card ko reply karke bhi update likh sakte hain</Text>}
      </View>
    ));
  }

  if (p && p.kind === 'reminder') {
    const mineTask = p.task.assigneeId === meId;
    return frame(OVERDUE_COLOR, (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="alarm" size={16} color={OVERDUE_COLOR} />
          <Text style={{ flex: 1, color: OVERDUE_COLOR, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>
            Ye task {p.days} din se pending hai, complete karo
          </Text>
        </View>
        <TaskLine task={p.task} t={t} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Action t={t} label="Open" onPress={() => onOpenTask(p.task.id)} />
          {mineTask && <Action t={t} label="Done" onPress={() => onSendText('/done #' + p.task.id)} />}
        </View>
      </View>
    ));
  }

  if (p && p.kind === 'list') {
    const shown = p.tasks.slice(0, 10);
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{p.title}</Text>
        {!shown.length && <Text style={{ color: t.subtext, fontSize: 13, marginTop: 6 }}>No tasks.</Text>}
        {shown.map((x) => (
          <Pressable key={x.id} onPress={() => onOpenTask(x.id)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: 1, borderTopColor: t.border, marginTop: 6, paddingTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ color: t.text, fontSize: 14 }}>{x.title}</Text>
              <Text style={{ color: x.overdue && x.status !== 'done' ? t.danger : t.subtext, fontSize: 12 }}>
                {x.assigneeName || 'Unassigned'}{x.dueDate ? '  ·  ' + formatDue(x.dueDate) : ''}
              </Text>
            </View>
            <StatusPill status={x.status} />
          </Pressable>
        ))}
        {p.tasks.length > shown.length && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 6 }}>+{p.tasks.length - shown.length} more in Tasks tab</Text>}
      </View>
    ));
  }

  if (p && p.kind === 'help') {
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>Commands</Text>
        {p.commands.map((c) => (
          <View key={c.cmd} style={{ marginTop: 6 }}>
            <Text style={{ color: t.text, fontSize: 13 }}>
              <Text style={{ fontWeight: '700', color: t.accent }}>{c.cmd}</Text>{c.args ? ' ' + c.args : ''}
            </Text>
            <Text style={{ color: t.subtext, fontSize: 12 }}>{c.desc}</Text>
          </View>
        ))}
      </View>
    ));
  }

  if (p && p.kind === 'error') {
    return frame('#F5A623', (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="warning" size={16} color="#F5A623" />
          <Text style={{ color: '#F5A623', fontSize: 12, fontWeight: '700', marginLeft: 6 }}>{p.code}</Text>
        </View>
        <Text style={{ color: t.text, fontSize: 14, marginTop: 4 }}>{p.message}</Text>
      </View>
    ));
  }

  if (p && p.kind === 'summary') {
    const sections = [
      { key: 'done' as const, label: 'Done' }, { key: 'in_progress' as const, label: 'Doing' }, { key: 'todo' as const, label: 'Todo' },
    ];
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{p.userName}'s tasks</Text>
        {sections.map((s) => (
          <View key={s.key} style={{ marginTop: 6 }}>
            <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{s.label} ({p.counts[s.key]})</Text>
            {p[s.key].map((i) => (
              <Text key={i.id} style={{ color: t.text, fontSize: 13 }}>{'• ' + i.title + (i.dueDate ? '  (' + formatDue(i.dueDate) + ')' : '')}</Text>
            ))}
          </View>
        ))}
      </View>
    ));
  }

  // clarify / info / unknown payload: plain text the server stored
  return frame(t.accent, <Text style={{ color: t.text, fontSize: 14 }}>{msg.text}</Text>);
}

export default React.memo(BotCardBase);
