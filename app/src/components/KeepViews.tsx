import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../useTheme';
import { Line, byDoneDesc, byNewest, dateTimeOf, dayYear, localYmd, timeOf } from '../taskFormat';
import Avatar from './Avatar';

// Google-Keep style building blocks of the Tasks tab (Round 4): a checkbox line, a card with a collapsible
// "Completed (n)" section, a 2-column masonry, and the Mine / Done lists.

export function LineRow({ line, onTick, onOpen, canTick, showPerson }: {
  line: Line; onTick: (l: Line) => void; onOpen: (l: Line) => void; canTick: boolean; showPerson?: boolean;
}) {
  const t = useTheme();
  const { task } = line;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 }}>
      <Pressable onPress={() => canTick && onTick(line)} hitSlop={8} disabled={!canTick} style={{ paddingTop: 1, paddingRight: 8, opacity: canTick ? 1 : 0.45 }}>
        <Ionicons name={line.done ? 'checkbox' : 'square-outline'} size={22} color={line.done ? t.accent : t.subtext} />
      </Pressable>
      <Pressable onPress={() => onOpen(line)} style={{ flex: 1 }}>
        <Text style={{ color: line.done ? t.subtext : t.text, fontSize: 14, textDecorationLine: line.done ? 'line-through' : 'none' }}>
          {showPerson ? line.name + ' · ' : ''}Task {task.id} · {task.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {line.done && <Text style={{ color: t.subtext, fontSize: 11 }}>{line.doneAt ? 'Done ' + dateTimeOf(line.doneAt) : 'Done'}</Text>}
          {line.others > 0 && (
            <View style={{ backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 6, marginLeft: 8 }}>
              <Text style={{ color: t.chipText, fontSize: 10, fontWeight: '700' }}>+{line.others}</Text>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export const estHeight = (lines: Line[]) => 60 + lines.length * 46;

// One card: title row (avatar / lock, tap = full list), open lines, collapsible Completed (n).
export function KeepCard({ title, userId, lock, lines, me, isBoss, onTick, onOpen, onTitle, showPerson }: {
  title: string; userId?: number | null; lock?: boolean; lines: Line[]; me: number; isBoss: boolean;
  onTick: (l: Line) => void; onOpen: (l: Line) => void; onTitle?: () => void; showPerson?: boolean;
}) {
  const t = useTheme();
  const [showDone, setShowDone] = useState(false);
  const open = lines.filter((l) => !l.done).sort(byNewest);
  const done = lines.filter((l) => l.done).sort(byDoneDesc);
  const can = (l: Line) => isBoss || l.userId === me;
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 12, marginBottom: 10 }}>
      <Pressable onPress={onTitle} disabled={!onTitle} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        {userId ? <Avatar name={title} id={userId} userId={userId} size={24} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: 15, marginLeft: userId ? 8 : 0 }}>
          {title}{lock ? ' 🔒' : ''}
        </Text>
        {!!onTitle && <Ionicons name="chevron-forward" size={16} color={t.subtext} />}
      </Pressable>
      {!open.length && !done.length && <Text style={{ color: t.subtext, fontSize: 12 }}>No tasks</Text>}
      {open.map((l) => <LineRow key={l.task.id + '-' + l.userId} line={l} onTick={onTick} onOpen={onOpen} canTick={can(l)} showPerson={showPerson} />)}
      {done.length > 0 && (
        <>
          <Pressable onPress={() => setShowDone((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <Ionicons name={showDone ? 'chevron-down' : 'chevron-forward'} size={14} color={t.subtext} />
            <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Completed ({done.length})</Text>
          </Pressable>
          {showDone && done.map((l) => <LineRow key={l.task.id + '-' + l.userId} line={l} onTick={onTick} onOpen={onOpen} canTick={can(l)} showPerson={showPerson} />)}
        </>
      )}
    </View>
  );
}

// 2 columns, each card goes to the shorter column (estimated height).
export function Masonry({ items }: { items: { key: string; h: number; node: React.ReactNode }[] }) {
  const cols: { h: number; nodes: React.ReactNode[] }[] = [{ h: 0, nodes: [] }, { h: 0, nodes: [] }];
  for (const it of items) {
    const c = cols[0].h <= cols[1].h ? cols[0] : cols[1];
    c.nodes.push(<React.Fragment key={it.key}>{it.node}</React.Fragment>);
    c.h += it.h;
  }
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 12, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, marginRight: 5 }}>{cols[0].nodes}</View>
      <View style={{ flex: 1, marginLeft: 5 }}>{cols[1].nodes}</View>
    </View>
  );
}

// Done history grouped by done date, newest first: "4:32 pm · Task 22 · title · Anubhav".
export function DoneList({ lines, onOpen }: { lines: Line[]; onOpen: (l: Line) => void }) {
  const t = useTheme();
  const sorted = lines.filter((l) => l.done).sort(byDoneDesc);
  const groups: { day: string; items: Line[] }[] = [];
  for (const l of sorted) {
    const day = l.doneAt ? localYmd(l.doneAt) : '';
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(l); else groups.push({ day, items: [l] });
  }
  return (
    <View style={{ paddingHorizontal: 12 }}>
      {groups.map((g) => (
        <View key={g.day} style={{ marginBottom: 10 }}>
          <Text style={{ color: t.subtext, fontSize: 12, fontWeight: '700', marginVertical: 6 }}>{g.day ? dayYear(g.day) : 'Earlier'}</Text>
          <View style={{ backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12 }}>
            {g.items.map((l, i) => (
              <Pressable key={l.task.id + '-' + l.userId} onPress={() => onOpen(l)} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
                <Text style={{ color: t.text, fontSize: 14 }}>
                  <Text style={{ color: t.subtext }}>{l.doneAt ? timeOf(l.doneAt) + ' · ' : ''}</Text>Task {l.task.id} · {l.task.title}
                  <Text style={{ color: t.subtext }}>{' · ' + l.name}</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

// Google Keep checklist note: one card per person, title "<Name> tasks", then a vertical list of square checkboxes + task
// title (wraps up to 3 lines, then an ellipsis). Tick = onTick (checkbox only); text tap = onOpen. `done` renders checked
// boxes with a strikethrough (Done tab); otherwise only open lines are shown (ticked ones leave the card).
export const CHECKLIST_LINES = 3;
export function ChecklistCard({ title, lines, me, isBoss, onTick, onOpen, done, onTitle }: {
  title: string; lines: Line[]; me: number; isBoss: boolean; onTick: (l: Line) => void; onOpen: (l: Line) => void; done?: boolean; onTitle?: () => void;
}) {
  const t = useTheme();
  const shown = lines.filter((l) => (done ? l.done : !l.done)).sort(done ? byDoneDesc : byNewest);
  return (
    <View testID="checklist-card" style={{ backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.border, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, marginBottom: 10 }}>
      <Pressable onPress={onTitle} disabled={!onTitle}>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '400', marginBottom: 8 }}>{title}</Text>
      </Pressable>
      {shown.map((l) => {
        const canTick = isBoss || l.userId === me;
        return (
          <View key={l.task.id + '-' + l.userId} style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 }}>
            <Pressable accessibilityRole="checkbox" accessibilityLabel={'Task ' + l.task.id} testID={'tick-' + l.task.id} onPress={() => canTick && onTick(l)} hitSlop={8} disabled={!canTick} style={{ paddingTop: 2, paddingRight: 10, opacity: canTick ? 1 : 0.45 }}>
              <Ionicons name={l.done ? 'checkbox' : 'square-outline'} size={20} color={l.done ? t.accent : t.subtext} />
            </Pressable>
            <Pressable onPress={() => onOpen(l)} style={{ flex: 1 }}>
              <Text testID={'title-' + l.task.id} numberOfLines={CHECKLIST_LINES} ellipsizeMode="tail" style={{ color: l.done ? t.subtext : t.text, fontSize: 15, lineHeight: 22, textDecorationLine: l.done ? 'line-through' : 'none' }}>
                {l.task.title}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
