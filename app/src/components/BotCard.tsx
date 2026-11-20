import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme';
import { api } from '../api';
import { Msg, BotPayload, TaskEventName } from '../chatTypes';
import { STALE_COLOR, Task, labelOf, colorOf, assigneeIdsOf, assigneeNamesOf, StepStatus, canTick, canUndoCard } from '../taskTypes';
import { usePublicSettings } from '../publicSettings';
import { useTaskState, ensureTask, putTask, applyTickTo, isBrief } from '../taskCache';
import { toast } from '../useVoiceInput';
import Avatar, { AvatarStack } from './Avatar';
import Sheet from './Sheet';
// Round 4: disabled (simple create->done): import StatusChips from './StatusChips';
import StatusChips from './DoneChips';
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
  due: { icon: 'calendar', color: '#F5A623' }, // old cards only (due dates were removed)
  deleted: { icon: 'close-circle', color: '#6B7280' },
  note: { icon: 'chatbubble-ellipses', color: '#34B7F1' },
  praise: { icon: 'heart', color: '#E5484D' },
};

const names = (t: Task) => assigneeNamesOf(t).join(', ');

export function headline(ev: TaskEventName | string, actor: string, t: Task) {
  const who = names(t);
  switch (ev) {
    case 'created': return actor + ' assigned Task ' + t.id + (who ? ' to ' + who : '');
    case 'completed': return actor + ' completed Task ' + t.id;
    // Round 4: disabled (simple create->done): step events (testing / planning / coding / change_merged) now read as an update
    case 'review': case 'testing': case 'planning': case 'coding': case 'change_merged': return actor + ' updated Task ' + t.id;
    case 'done': return actor + ' marked their part Done (Task ' + t.id + ')';
    case 'closed': case 'deleted': return actor + ' closed Task ' + t.id;
    case 'reopened': return actor + ' reopened a task';
    case 'answered': return actor + ' replied';
    case 'reassigned': return actor + ' changed the people' + (who ? ': ' + who : '');
    case 'due': return actor + ' updated Task ' + t.id;
    case 'note': return actor + ' added a note';
    case 'praise': return actor + ' praised ' + (who || 'the work');
    default: return actor + ' updated Task ' + t.id;
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
        <Text style={{ color: t.subtext, fontSize: 12, marginLeft: 8, flexShrink: 1 }}>
          {names(task) || 'Unassigned'}  ·  Task {task.id}
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
  const [tick, setTick] = useState<boolean | null>(null); // my checkbox on a task card
  const [picked, setPicked] = useState<number | null>(null);
  const [brief, setBrief] = useState(false); // short info sheet for a task I cannot open
  const [actions, setActions] = useState(false); // TaskActionSheet (ask card "Description")
  const [myStep, setMyStep] = useState<StepStatus | null>(null); // ask card: status I just set
  const p = msg.payload as BotPayload | null | undefined;
  // Round 4: card shows the CURRENT task (shared cache: ws 'task' events + batched fetch), not the stored snapshot
  const liveId = p && p.kind === 'task' && !msg.deleted ? p.task.id : null;
  const live = useTaskState(liveId);
  useEffect(() => { if (liveId != null) ensureTask(liveId); }, [liveId]);
  const frame = (color: string, body: React.ReactNode, onPress?: () => void) => (
    <Frame t={t} color={color} msg={msg} time={time} onLongPress={onLongPress} onPress={onPress} compact={compact} quote={quote}>{body}</Frame>
  );

  // Round 4: AI answer cards are drawn by Bubble (chat screen), never here
  if (p && (p as any).kind === 'ai_answer') return (msg.text ? frame(t.accent, <Text style={{ color: t.text, fontSize: 14 }}>{msg.text}</Text>) : null);

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
    <Sheet visible={brief} onClose={() => setBrief(false)} title={'Task ' + task.id}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{task.title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Pill status={task.status} />
          <Text style={{ color: t.subtext, fontSize: 13, marginLeft: 8, flex: 1 }}>{names(task) || 'Unassigned'}</Text>
        </View>
        <Text style={{ color: t.subtext, fontSize: 12, marginTop: 10 }}>Only the admin, the creator and the assignees can see this task's details.</Text>
      </View>
    </Sheet>
  );

  if (p && p.kind === 'task') {
    const ev = eventOf(p);
    const meta = EVENT[ev] ?? EVENT.updated;
    // full state when I can view the task; else only the brief's title + status over the snapshot (nothing private)
    const task: Task = live ? (isBrief(live) ? { ...p.task, title: live.title, status: live.status } : live) : p.task;
    const gone = ev === 'deleted'; // old cards
    const closed = task.status === 'closed';
    const canOpen = viewable(task, meId, isBoss);

    // Round 4: disabled (simple create->done): praise
    // const canPraise = !praised && !gone && ps.praiseEnabled && ['completed', 'done', 'review', 'testing', 'change_merged'].includes(ev) && (isBoss || creator) && !mine;
    const canPraise = false;
    // Round 4: one Keep-style checkbox (my own tick; the admin who is not on the task ticks it for all)
    const me_ = { id: meId, role: (isBoss ? 'boss' : 'member') as 'boss' | 'member' };
    const showTick = !gone && !closed && !['praise', 'note', 'closed', 'reopened', 'answered', 'deleted'].includes(ev) && canTick(task, me_);
    const myRow = (task.assignees || []).find((a) => a.id === meId);
    const baseDone = myRow ? myRow.status === 'done' : task.status === 'done';
    const tickedNow = baseDone;
    const canUndo = !undone && !gone && canUndoCard(ev, task, me_, baseDone);
    const doTick = () => guard(async () => {
      const before = task;
      putTask(applyTickTo(task, myRow ? meId : null, !tickedNow)); // optimistic, shared by every card of this task
      try {
        const r = await api<{ task: Task }>('PATCH', '/tasks/' + task.id, { status: tickedNow ? 'todo' : 'done', ...(myRow ? { userId: meId } : {}) });
        if (r && r.task) putTask(r.task);
      } catch (e) { putTask(before); throw e; }
    }, () => {});
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
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
              {showTick && (
                <Pressable onPress={doTick} hitSlop={8} disabled={busy} style={{ marginRight: 8, marginTop: 1 }}>
                  <Ionicons name={tickedNow ? 'checkbox' : 'square-outline'} size={22} color={tickedNow ? t.accent : t.subtext} />
                </Pressable>
              )}
              <Text numberOfLines={compact ? 2 : 3} style={{ flex: 1, color: t.text, fontSize: compact ? 14 : 15, fontWeight: '600', textDecorationLine: gone || (showTick && tickedNow) ? 'line-through' : 'none' }}>
                {task.title}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              {!!task.project && (
                <View style={{ backgroundColor: t.soft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 }}>
                  <Text style={{ color: t.subtext, fontSize: 11, fontWeight: '600' }}>{task.project}</Text>
                </View>
              )}
              {!gone && <Pill status={task.status} />}
              {people.length > 0 && <View style={{ marginLeft: 8 }}><AvatarStack people={people} size={compact ? 18 : 20} /></View>}
              <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12, marginLeft: 6, flexShrink: 1 }}>
                {names(task) || 'Unassigned'}  ·  Task {task.id}
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
            <Text style={{ color: t.subtext, fontSize: 11, marginLeft: 8 }}>Task {x.id}</Text>
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
                {(p.actorName || 'Someone') + ' asked for the status of Task ' + p.task.id + (names(p.task) ? ' · ' + names(p.task) : '')}
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
              {mineTask && !onReply && !!onPrefill && <Action t={t} label="Update" onPress={() => onPrefill('/update Task ' + p.task.id + ' ')} />}
            </View>
            {mineTask && <Text style={{ color: t.subtext, fontSize: 11, marginTop: 6 }}>Reply to this card to answer (the asker will be notified)</Text>}
          </View>
        ), !canOpen ? () => setBrief(true) : undefined)}
        {brief && briefSheet(p.task)}
        {actions && <TaskActionSheet visible={actions} onClose={() => setActions(false)} taskId={p.task.id} onOpen={onOpenTask} startMode="desc" />}
      </>
    );
  }

  if (p && p.kind === 'reminder') {
    const mineTask = p.assigneeId === meId || assigneeIdsOf(p.task).includes(meId);
    return frame(STALE_COLOR, (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="alarm" size={16} color={STALE_COLOR} />
          <Text style={{ flex: 1, color: STALE_COLOR, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>
            This task has been pending for {p.days} days. Please complete it.
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
              <Text numberOfLines={1} style={{ color: t.subtext, fontSize: 12 }}>
                {'Task ' + x.id + '  ·  ' + (x.assigneeName || 'Unassigned')}
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
          const list = p[k] as { id: number; title: string }[];
          return (
            <View key={k} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(k), marginRight: 6 }} />
                <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600' }}>{labelOf(k)} ({counts[k] ?? list.length})</Text>
              </View>
              {list.map((i) => (
                <Text key={i.id} style={{ color: t.text, fontSize: 13 }}>{'• ' + i.title}</Text>
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
