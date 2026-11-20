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
  const banned = /(\bnahi\b|\bnhi\b|dobara|\bkarein\b|\bkaro\b|kisko|likhiye|\bhai\b|\bbaaki\b|\bAaj\b|\bKal\b|\bbhejo\b|\bnaam\b|\bkaam\b|chuniye|\bjawab\b|\bpooch|\bmein\b|\bliye\b)/;
  const bad: string[] = [];
  for (const f of SRC) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      if (banned.test(line)) bad.push(path.basename(f) + ':' + (i + 1));
    });
  }
  expect(bad).toEqual([]);
});
