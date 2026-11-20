jest.mock('../useVoiceInput', () => ({ toast: jest.fn() })); // dates.ts pulls in the native speech module
// R-06 / R-07 / R-08 on the app side: who may tick / delete, no due date anywhere, English text.
import * as fs from 'fs';
import * as path from 'path';
import { canClose, canTick, Task } from '../taskTypes';
import * as F from '../taskFormat';

const task = (over: Partial<Task> = {}): Task => ({
  id: 1, title: 'T', status: 'todo', createdBy: 5, assignees: [{ id: 7, name: 'A', avatarEmoji: null, status: 'todo', completedAt: null }], ...over,
} as any);
const boss = { id: 1, role: 'boss' as const };
const assignee = { id: 7, role: 'member' as const };
const creator = { id: 5, role: 'member' as const }; // created it but is not the assignee
const other = { id: 9, role: 'member' as const };

test('tick: only the assignee or an admin', () => {
  expect(canTick(task(), assignee)).toBe(true);
  expect(canTick(task(), boss)).toBe(true);
  expect(canTick(task(), creator)).toBe(false);
  expect(canTick(task(), other)).toBe(false);
  expect(canTick(task({ status: 'closed' }), boss)).toBe(false);
});

test('delete / close / reopen: admin only (not even the creator or the assignee)', () => {
  expect(canClose(task(), boss)).toBe(true);
  expect(canClose(task(), creator)).toBe(false);
  expect(canClose(task(), assignee)).toBe(false);
  expect(canClose(task(), other)).toBe(false);
});

test('no due-date helpers are left in the task formatting module', () => {
  expect((F as any).dueLine).toBeUndefined();
  expect((F as any).bucketOf).toBeUndefined();
  expect((F as any).byDue).toBeUndefined();
});

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '__tests__' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const SRC = walk(path.join(__dirname, '..')).filter((f) => /\.(ts|tsx)$/.test(f));

test('R-07: no task due-date UI or fields in app source', () => {
  const bad = SRC.filter((f) => /dueDate|dueAt|DUE_CHIPS|formatDue|Due date/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
  expect(bad).toEqual([]);
});

test('R-08: no Hinglish phrases in app source strings', () => {
  const banned = /(\bnahi\b|\bnhi\b|dobara|\bkarein\b|\bkaro\b|kisko|likhiye|\bhai\b|\bbaaki\b|\bAaj\b|\bKal\b|\bbhejo\b|\bnaam\b|\bkaam\b|chuniye|\bjawab\b|\bpooch|\bmein\b|\bliye\b|badlo|\bmera\b|\bmeri\b|\bkya\b|\babhi\b|\bwapas\b|\bdekho\b|\blikho\b|\brakho\b)/i;
  const bad: string[] = [];
  for (const f of SRC) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (banned.test(line)) bad.push(path.basename(f) + ':' + (i + 1));
    });
  }
  expect(bad).toEqual([]);
});

test('task card Undo: "assigned" card = admin only; "completed" card only while still done, for who may tick', () => {
  const { canUndoCard } = require('../taskTypes');
  // assigned card: Undo closes the task -> admin only (the member creator used to get "Not allowed")
  expect(canUndoCard('created', task(), boss, false)).toBe(true);
  expect(canUndoCard('created', task(), creator, false)).toBe(false);
  expect(canUndoCard('created', task(), assignee, false)).toBe(false);
  // completed card: only while the task is still done, and only for the assignee / admin
  expect(canUndoCard('completed', task({ status: 'done' }), assignee, true)).toBe(true);
  expect(canUndoCard('completed', task({ status: 'done' }), boss, true)).toBe(true);
  expect(canUndoCard('completed', task(), assignee, false)).toBe(false); // reopened since: no stale Undo
  expect(canUndoCard('completed', task({ status: 'done' }), creator, true)).toBe(false);
  expect(canUndoCard('completed', task({ status: 'done' }), other, true)).toBe(false);
  // closed task or other card kinds: never
  expect(canUndoCard('created', task({ status: 'closed' }), boss, false)).toBe(false);
  expect(canUndoCard('reassigned', task(), boss, false)).toBe(false);
  expect(canUndoCard('created', task(), null, false)).toBe(false);
});

test('title / people (canManage): admin always; creator or assignee only while members may assign', () => {
  const { canManage } = require('../taskTypes');
  expect(canManage(task(), boss, false)).toBe(true);
  expect(canManage(task(), creator, true)).toBe(true);
  expect(canManage(task(), assignee, true)).toBe(true);
  expect(canManage(task(), creator, false)).toBe(false); // the "Change" link used to show and the save failed (403)
  expect(canManage(task(), assignee, false)).toBe(false);
  expect(canManage(task(), other, true)).toBe(false);
  expect(canManage(task({ status: 'closed' }), boss, true)).toBe(false);
});
