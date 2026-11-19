import React, { useState } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { api } from '../api';
import { Msg, BotPayload, TaskEventName } from '../chatTypes';
import { OVERDUE_COLOR, Task, labelOf, colorOf, assigneeIdsOf, assigneeNamesOf, StepStatus } from '../taskTypes';
import { usePublicSettings } from '../publicSettings';
import { formatDue } from '../dates';
import { toast } from '../useVoiceInput';
import Avatar, { AvatarStack } from './Avatar';
import Sheet from './Sheet';
import StatusChips from './StatusChips';
import TaskActionSheet from './TaskActionSheet';

type IconName = keyof typeof Ionicons.glyphMap;
export const EVENT: Record<string, { icon: IconName; color: string }> = {
  created: { icon: 'add-circle', color: '#F5A623' },
  updated: { icon: 'refresh-circle', color: '#34B7F1' },
  completed: { icon: 'checkmark-circle', color: '#25D366' },
  review: { icon: 'flask', color: '#A970FF' },
  planning: { icon: 'bulb', color: '#8E9AAF' },
  coding: { icon: 'code-slash', color: '#34B7F1' },
  testing: { icon: 'flask', color: '#A970FF' },
  change_merged: { icon: 'git-merge', color: '#14B8A6' },
  done: { icon: 'checkmark-done-circle', color: '#25D366' },
  closed: { icon: 'close-circle', color: '#6B7280' },
  reopened: { icon: 'refresh', color: '#F5A623' },
  answered: { icon: 'chatbubbles', color: '#34B7F1' },
  reassigned: { icon: 'swap-horizontal', color: '#34B7F1' },
  due: { icon: 'calendar', color: '#F5A623' },
  deleted: { icon: 'close-circle', color: '#6B7280' },
  note: { icon: 'chatbubble-ellipses', color: '#34B7F1' },
  praise: { icon: 'heart', color: '#E5484D' },
};

const names = (t: Task) => assigneeNamesOf(t).join(', ');

export function headline(ev: TaskEventName | string, actor: string, t: Task) {
  const who = names(t);
  switch (ev) {
    case 'created': return actor + ' assigned a task' + (who ? ' to ' + who : '');
    case 'completed': return actor + ' completed a task';
    case 'review': case 'testing': return actor + ' moved a task to Testing';
    case 'planning': return actor + ' moved a task to Planning';
    case 'coding': return actor + ' moved a task to Coding';
    case 'change_merged': return actor + ': Change merged';
    case 'done': return actor + ' ne apna part Done kiya';
    case 'closed': case 'deleted': return actor + ' closed a task';
    case 'reopened': return actor + ' reopened a task';
    case 'answered': return actor + ' ne jawab diya';
    case 'reassigned': return actor + ' changed the people' + (who ? ': ' + who : '');
    case 'due': return actor + ' changed the due date';
    case 'note': return actor + ' added a note';
    case 'praise': return actor + ' praised ' + (who || 'the work');
    default: return actor + ' updated a task';
  }
}

export const eventOf = (p: Extract<BotPayload, { kind: 'task' }>): TaskEventName => p.event ?? p.action ?? 'updated';

// status pill for any key (old payloads: in_progress / review)
export function Pill({ status }: { status: string }) {
  return (
    <View style={{ backgroundColor: colorOf(status), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{labelOf(status)}</Text>
    </View>
  );
}

// people on a task for avatars (old payloads: only the primary)
const peopleOf = (task: Task) =>
  task.assignees && task.assignees.length
    ? task.assignees.map((a) => ({ id: a.id, name: a.name, avatarEmoji: a.avatarEmoji }))
    : task.assigneeId ? [{ id: task.assigneeId, name: task.assigneeName || '?', avatarEmoji: null }] : [];

type Props = {
  msg: Msg; t: Theme; meId: number; isBoss: boolean; time: string;
  onLongPress: (m: Msg) => void; onOpenTask: (id: number) => void; onSendText: (text: string, mentionIds?: number[]) => void;
  onPrefill?: (text: string) => void;
  onReply?: (m: Msg) => void; // ask card "Reply": starts the composer reply to this card
  compact?: boolean; // attached under the source message (TaskAttachment)
  quote?: string | null; // AI filter: one line of the message that caused the card
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
        <Pill status={task.status} />
        <Text style={{ color: task.overdue && task.status !== 'done' ? t.danger : t.subtext, fontSize: 12, marginLeft: 8, flexShrink: 1 }}>
          {names(task) || 'Unassigned'}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}  ·  #{task.id}
        </Text>
      </View>
    </View>
  );
}

function Frame({ t, color, msg, time, onLongPress, onPress, compact, quote, children }: {
  t: Theme; color: string; msg: Msg; time: string; onLongPress: (m: Msg) => void; onPress?: () => void; compact?: boolean;
  quote?: string | null; children: React.ReactNode;
}) {
  return (
    <View style={compact ? { marginTop: 4 } : { paddingHorizontal: 16, marginVertical: 5, alignItems: 'center' }}>
      <Pressable
        onLongPress={() => onLongPress(msg)} onPress={onPress}
        style={{
          width: '100%', maxWidth: 420, flexDirection: 'row', backgroundColor: t.card, borderRadius: compact ? 10 : 14,
          overflow: 'hidden', elevation: compact ? 0 : 1, borderWidth: compact ? 1 : 0, borderColor: t.border,
        }}
      >
        <View style={{ width: compact ? 3 : 4, backgroundColor: color }} />
        <View style={{ flex: 1, paddingHorizontal: compact ? 9 : 12, paddingTop: compact ? 6 : 8, paddingBottom: compact ? 4 : 6 }}>
          {!!quote && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Ionicons name="return-down-forward" size={12} color={t.subtext} />
              <Text numberOfLines={1} style={{ flex: 1, color: t.subtext, fontSize: 12, fontStyle: 'italic', marginLeft: 4 }}>{quote}</Text>
            </View>
          )}
          {children}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 }}>
            {msg.visibleTo != null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Ionicons name="eye-off-outline" size={12} color={t.subtext} />
                <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 4 }}>Only visible to you</Text>
              </View>
            )}
            {!compact && <Text style={{ color: t.subtext, fontSize: 11 }}>{time}</Text>}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function Action({ label, onPress, t, color, disabled, small }: { label: string; onPress: () => void; t: Theme; color?: string; disabled?: boolean; small?: boolean }) {
  const c = color ?? t.accent;
  return (
    <Pressable
      onPress={onPress} disabled={disabled} hitSlop={small ? 6 : 0}
      style={{ height: small ? 28 : 32, justifyContent: 'center', paddingHorizontal: small ? 10 : 12, borderRadius: 16, borderWidth: 1, borderColor: c, marginRight: 8, marginTop: 6, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ color: c, fontWeight: '600', fontSize: small ? 12 : 13, includeFontPadding: false }}>{label}</Text>
    </Pressable>
  );
}

// Viewer may open the task: boss, creator or one of the people (server re-checks; 403 otherwise).
const viewable = (task: Task, meId: number, isBoss: boolean) => isBoss || task.createdBy === meId || assigneeIdsOf(task).includes(meId);

function BotCardBase({ msg, t, meId, isBoss, time, onLongPress, onOpenTask, onSendText, onPrefill, onReply, compact, quote }: Props) {
  const ps = usePublicSettings();
  const [undone, setUndone] = useState(false);
  const [praised, setPraised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [brief, setBrief] = useState(false); // short info sheet for a task I cannot open
  const [actions, setActions] = useState(false); // TaskActionSheet (ask card "Description")
  const [myStep, setMyStep] = useState<StepStatus | null>(null); // ask card: status I just set
  const p = msg.payload as BotPayload | null | undefined;
  const frame = (color: string, body: React.ReactNode, onPress?: () => void) => (
    <Frame t={t} color={color} msg={msg} time={time} onLongPress={onLongPress} onPress={onPress} compact={compact} quote={quote}>{body}</Frame>
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

  const briefSheet = (task: Task) => (
    <Sheet visible={brief} onClose={() => setBrief(false)} title={'#' + task.id}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{task.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Pill status={task.status} />
          <Text style={{ color: t.subtext, fontSize: 13, marginLeft: 8, flex: 1 }}>{names(task) || 'Unassigned'}</Text>
        </View>
        <Text style={{ color: t.subtext, fontSize: 12, marginTop: 10 }}>Is task ki details sirf admin, banane wala aur assignees dekh sakte hain.</Text>
      </View>
    </Sheet>
  );

  if (p && p.kind === 'task') {
    const ev = eventOf(p);
    const meta = EVENT[ev] ?? EVENT.updated;
    const task = p.task;
    const gone = ev === 'deleted'; // old cards
    const closed = task.status === 'closed';
    const creator = task.createdBy === meId;
    const mine = assigneeIdsOf(task).includes(meId);
    const canOpen = viewable(task, meId, isBoss);
    const canUndo = !undone && !gone && !closed && !['praise', 'note', 'closed', 'reopened', 'answered'].includes(ev) &&
      (ev === 'created' ? isBoss || creator : isBoss || mine);
    const canPraise = !praised && !gone && ps.praiseEnabled && ['completed', 'done', 'review', 'testing', 'change_merged'].includes(ev) &&
      (isBoss || creator) && !mine;
    const people = peopleOf(task);
    return (
      <>
        {frame(meta.color, (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={meta.icon} size={compact ? 14 : 16} color={meta.color} />
              <Text numberOfLines={2} style={{ flex: 1, color: t.subtext, fontSize: compact ? 11 : 12, fontWeight: '600', marginLeft: 6 }}>
                {headline(ev, p.actorName || 'Someone', task)}{p.edited ? '  (edited)' : ''}
              </Text>
              {!!p.byAi && (
                <Text style={{ color: t.subtext, fontSize: 10, fontWeight: '700', borderWidth: 1, borderColor: t.border, borderRadius: 6, paddingHorizontal: 5, marginLeft: 6 }}>AI</Text>
              )}
            </View>
            <Text numberOfLines={compact ? 2 : 3} style={{ color: t.text, fontSize: compact ? 14 : 15, fontWeight: '600', marginTop: 4, textDecorationLine: gone ? 'line-through' : 'none' }}>
              {task.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              {!!task.project && (
                <View style={{ backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                  <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
                </View>
              )}
              {!gone && <Pill status={task.status} />}
              {people.length > 0 && <View style={{ marginLeft: 8 }}><AvatarStack people={people} size={compact ? 18 : 20} /></View>}
              <Text numberOfLines={1} style={{ color: task.overdue && task.status !== 'done' ? t.danger : t.subtext, fontSize: 12, marginLeft: 6, flexShrink: 1 }}>
                {names(task) || 'Unassigned'}{task.dueDate ? '  ·  ' + formatDue(task.dueDate) : ''}  ·  #{task.id}
              </Text>
            </View>
            {!!p.note && (
              <Text style={{ color: t.text, fontSize: 13, fontStyle: 'italic', marginTop: 6 }} numberOfLines={4}>{'"' + p.note + '"'}</Text>
            )}
            {undone && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 6, fontStyle: 'italic' }}>Undone</Text>}
            {((!gone && canOpen) || canUndo || canPraise || praised) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                {!gone && canOpen && <Action small={compact} t={t} label="Open" onPress={() => onOpenTask(task.id)} />}
                {canUndo && (
                  <Action
                    small={compact} t={t} label={busy ? '...' : 'Undo'} color={t.subtext} disabled={busy}
                    // a just-created task is closed (DELETE = close now); a status change goes back one step
                    onPress={() => guard(
                      () => (ev === 'created' ? api('POST', '/tasks/' + task.id + '/close', { reason: 'undo' }) : api('POST', '/tasks/' + task.id + '/undo')),
                      () => setUndone(true),
                    )}
                  />
                )}
                {canPraise && (
                  <Action small={compact} t={t} label={'👏 Praise'} disabled={busy}
                    onPress={() => guard(() => api('POST', '/tasks/' + task.id + '/praise', {}), () => setPraised(true))} />
                )}
                {praised && <Text style={{ color: t.subtext, fontSize: 12, marginTop: 6 }}>Praised</Text>}
              </View>
            )}
          </View>
        ), !canOpen && !gone ? () => setBrief(true) : undefined)}
        {brief && briefSheet(task)}
      </>
    );
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
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(x.status), marginRight: 10 }} />
            <Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 14 }}>{x.title}</Text>
            <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 8 }}>#{x.id}</Text>
          </Pressable>
        ))}
      </View>
    ));
  }

  if (p && p.kind === 'userpicker') {
    // tap = re-send the command for exactly this person; people already resolved in the command (keep) stay in
    // mentionIds before the picked one (their '@Name' labels are already in pre)
    const resend = (u: { id: number; name: string }) =>
      '/' + p.command.replace(/^\//, '') + (p.pre ? ' ' + p.pre : '') + ' @' + firstName(u.name) + (p.arg ? ' ' + p.arg : '');
    const keepIds = (p.keep || []).map((k) => k.id);
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14 }}>{p.text}</Text>
        {p.users.map((u) => (
          <Pressable
            key={u.id}
            disabled={picked !== null}
            onPress={() => { setPicked(u.id); onSendText(resend(u), [...keepIds, u.id]); }}
            style={{
              flexDirection: 'row', alignItems: 'center', minHeight: 48, marginTop: 8, paddingHorizontal: 10, borderRadius: 12,
              backgroundColor: t.soft, opacity: picked !== null && picked !== u.id ? 0.4 : 1,
            }}
          >
            <Avatar name={u.name} id={u.id} userId={u.id} size={30} />
            <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, marginLeft: 10 }}>{u.name}</Text>
            {!!u.phoneTail && <Text style={{ color: t.subtext, fontSize: 12 }}>...{u.phoneTail}</Text>}
          </Pressable>
        ))}
      </View>
    ));
  }

  if (p && p.kind === 'ask') {
    const askedIds = p.assigneeIds && p.assigneeIds.length ? p.assigneeIds : [p.assigneeId ?? p.task.assigneeId].filter((x): x is number => !!x);
    const mineTask = askedIds.includes(meId);
    const canOpen = viewable(p.task, meId, isBoss);
    const mineNow = myStep ?? (p.task.assignees || []).find((a) => a.id === meId)?.status ?? null;
    const setStep = (s: StepStatus) => guard(
      () => api('PATCH', '/tasks/' + p.task.id, { status: s }),
      () => { setMyStep(s); toast('Status: ' + labelOf(s)); },
    );
    return (
      <>
        {frame('#34B7F1', (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="help-circle" size={16} color="#34B7F1" />
              <Text numberOfLines={2} style={{ flex: 1, color: t.subtext, fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
                {(p.actorName || 'Someone') + ' ne status poocha' + (names(p.task) ? ' · ' + names(p.task) : '')}
              </Text>
            </View>
            <TaskLine task={p.task} t={t} />
            {mineTask && p.task.status !== 'closed' && (
              <View style={{ marginTop: 8 }}>
                <StatusChips value={mineNow} onPick={setStep} disabled={busy} small />
              </View>
            )}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
              {canOpen && <Action t={t} label="Open" onPress={() => onOpenTask(p.task.id)} />}
              {mineTask && !!onReply && !!msg.id && <Action t={t} label="Reply" onPress={() => onReply(msg)} />}
              {mineTask && <Action t={t} label="Description" onPress={() => setActions(true)} />}
              {mineTask && !onReply && !!onPrefill && <Action t={t} label="Update" onPress={() => onPrefill('/update #' + p.task.id + ' ')} />}
            </View>
            {mineTask && <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>Is card ko reply karke jawab likho (asker ko notification jayega)</Text>}
          </View>
        ), !canOpen ? () => setBrief(true) : undefined)}
        {brief && briefSheet(p.task)}
        {actions && <TaskActionSheet visible={actions} onClose={() => setActions(false)} taskId={p.task.id} onOpen={onOpenTask} startMode="desc" />}
      </>
    );
  }

  if (p && p.kind === 'reminder') {
    const mineTask = p.assigneeId === meId || assigneeIdsOf(p.task).includes(meId);
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
          <Pressable
            key={x.id} disabled={!!x.brief} onPress={() => onOpenTask(x.id)}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, borderTopWidth: 1, borderTopColor: t.border, marginTop: 4, paddingTop: 4 }}
          >
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 14 }}>{x.title}</Text>
              <Text numberOfLines={1} style={{ color: x.overdue && x.status !== 'done' ? t.danger : t.subtext, fontSize: 12 }}>
                {'#' + x.id + '  ·  ' + (x.assigneeName || 'Unassigned')}{x.dueDate ? '  ·  ' + formatDue(x.dueDate) : ''}
              </Text>
            </View>
            <Pill status={x.status} />
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
    // round 3 keys + old (in_progress / review) cards; a section shows when the payload has its list
    const keys = ['done', 'change_merged', 'testing', 'review', 'coding', 'in_progress', 'planning', 'todo']
      .filter((k) => Array.isArray(p[k]));
    const counts = p.counts || {};
    return frame(t.accent, (
      <View>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', marginBottom: 2 }}>{p.userName}'s tasks</Text>
        {keys.map((k) => {
          const list = p[k] as { id: number; title: string; dueDate?: string | null }[];
          return (
            <View key={k} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(k), marginRight: 6 }} />
                <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{labelOf(k)} ({counts[k] ?? list.length})</Text>
              </View>
              {list.map((i) => (
                <Text key={i.id} style={{ color: t.text, fontSize: 13 }}>{'• ' + i.title + (i.dueDate ? '  (' + formatDue(i.dueDate) + ')' : '')}</Text>
              ))}
            </View>
          );
        })}
      </View>
    ));
  }

  // clarify / info / unknown payload: plain text the server stored
  return frame(t.accent, <Text style={{ color: t.text, fontSize: 14 }}>{msg.text}</Text>);
}

export default React.memo(BotCardBase);
