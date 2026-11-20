// C-01..C-04: daily check-in briefing card (morning picks, evening ticks, reply box, admins' summary).
jest.mock('../useVoiceInput', () => ({ toast: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../api', () => ({ api: jest.fn() }));
jest.mock('../outbox', () => ({ newClientId: () => 'cid-1' }));
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import DailyCheckinCard, { PILL, TEXT } from '../components/DailyCheckinCard';
import { dark } from '../theme';
import { Msg } from '../chatTypes';

const apiMod = require('../api');
const { toast } = require('../useVoiceInput');
const TODAY = '2026-11-20';
const task = (id: number, title: string, status: 'todo' | 'done' = 'todo') => ({ id, title, status });
const msg = (payload: any, id = 50): Msg => ({ id, chatId: 9, senderId: 1, senderName: 'Team Assistant', text: '', type: 'checkin_prompt', payload, createdAt: TODAY + 'T04:30:00Z' } as any);
const card = (payload: any, extra: any = {}) =>
  render(<DailyCheckinCard msg={msg(payload)} t={dark} time="10:00" meId={7} meName="Anubhav" today={TODAY} {...extra} />);

beforeEach(() => { apiMod.api.mockReset(); apiMod.api.mockResolvedValue({}); (toast as jest.Mock).mockReset(); });

test('morning: greeting + date, one row per task with an OPEN pill, a Today toggle and the "new work" box', () => {
  const r = card({ kind: 'day', date: TODAY, tasks: [task(1, 'Write report'), task(2, 'Fix login')], picks: [2] });
  expect(r.getByText('Good morning, Anubhav')).toBeTruthy();
  expect(r.getByText('Fri, 20 Nov')).toBeTruthy();
  expect(r.getByText(TEXT.morningAsk)).toBeTruthy();
  expect(r.getByText('Write report')).toBeTruthy();
  expect(r.getAllByTestId('pill-open')).toHaveLength(1);
  expect(r.getAllByTestId('pill-today')).toHaveLength(1); // picked one shows TODAY
  expect(r.getByTestId('today-2').props.accessibilityState).toMatchObject({ checked: true });
  expect(r.getByTestId('checkin-reply').props.placeholder).toBe(TEXT.morningBox);
  expect(r.queryByTestId('done-1')).toBeNull();
});

test('morning: tapping Today posts the pick and flips the pill at once; a failure reverts with a toast', async () => {
  const r = card({ kind: 'day', date: TODAY, tasks: [task(1, 'Write report')], picks: [] });
  fireEvent.press(r.getByTestId('today-1'));
  expect(apiMod.api).toHaveBeenCalledWith('POST', '/checkins/picks', { taskId: 1, today: true });
  expect(r.getByTestId('pill-today')).toBeTruthy();
  await waitFor(() => expect(r.getByTestId('today-1').props.accessibilityState).toMatchObject({ checked: true }));
  apiMod.api.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { fireEvent.press(r.getByTestId('today-1')); });
  await waitFor(() => expect(toast).toHaveBeenCalledWith(TEXT.pickFailed));
  expect(r.getByTestId('today-1').props.accessibilityState).toMatchObject({ checked: true }); // back to what it showed before the failed tap
});

test('evening: Done tick goes through the normal task API as my own status; done rows show DONE', async () => {
  const r = card({ kind: 'signoff', date: TODAY, tasks: [task(1, 'Write report'), task(3, 'Old thing', 'done')] });
  expect(r.getByText(TEXT.eveningTitle)).toBeTruthy();
  expect(r.getByText(TEXT.eveningAsk)).toBeTruthy();
  expect(r.getAllByTestId('pill-done')).toHaveLength(1);
  expect(r.getByTestId('checkin-reply').props.placeholder).toBe(TEXT.eveningBox);
  await act(async () => { fireEvent.press(r.getByTestId('done-1')); });
  expect(apiMod.api).toHaveBeenCalledWith('PATCH', '/tasks/1', { status: 'done', userId: 7 });
  expect(r.getAllByTestId('pill-done')).toHaveLength(2);
  await act(async () => { fireEvent.press(r.getByTestId('done-3')); }); // untick
  expect(apiMod.api).toHaveBeenLastCalledWith('PATCH', '/tasks/3', { status: 'todo', userId: 7 });
});

test('evening: a refused tick (e.g. 403) reverts and says so', async () => {
  apiMod.api.mockRejectedValueOnce(Object.assign(new Error('Not allowed'), { status: 403 }));
  const r = card({ kind: 'signoff', date: TODAY, tasks: [task(1, 'Write report')] });
  await act(async () => { fireEvent.press(r.getByTestId('done-1')); });
  expect(toast).toHaveBeenCalledWith(TEXT.tickFailed);
  expect(r.queryByTestId('pill-done')).toBeNull();
});

test('reply box posts a normal message in this chat and clears; failure keeps the text', async () => {
  const r = card({ kind: 'signoff', date: TODAY, tasks: [] });
  expect(r.getByText(TEXT.eveningEmpty)).toBeTruthy(); // empty state still asks
  fireEvent.changeText(r.getByTestId('checkin-reply'), '  Finished the report  ');
  await act(async () => { fireEvent.press(r.getByTestId('checkin-send')); });
  expect(apiMod.api).toHaveBeenCalledWith('POST', '/chats/9/messages', { text: 'Finished the report', clientId: 'cid-1' });
  expect(r.getByTestId('checkin-reply').props.value).toBe('');
  apiMod.api.mockRejectedValueOnce(new Error('offline'));
  fireEvent.changeText(r.getByTestId('checkin-reply'), 'Second');
  await act(async () => { fireEvent.press(r.getByTestId('checkin-send')); });
  expect(toast).toHaveBeenCalledWith(TEXT.notSent);
  expect(r.getByTestId('checkin-reply').props.value).toBe('Second');
});

test('morning empty state asks what is new', () => {
  const r = card({ kind: 'day', date: TODAY, tasks: [], picks: [] });
  expect(r.getByText(TEXT.morningEmpty)).toBeTruthy();
  expect(r.getByTestId('checkin-reply')).toBeTruthy();
});

test('an old day is read-only: no buttons, no reply box', () => {
  const r = card({ kind: 'signoff', date: '2026-11-19', tasks: [task(1, 'Write report')] });
  expect(r.getByText('Write report')).toBeTruthy();
  expect(r.queryByTestId('done-1')).toBeNull();
  expect(r.queryByTestId('checkin-reply')).toBeNull();
});

test('a new payload from the server (ws edited) replaces the optimistic state', async () => {
  const p1 = { kind: 'signoff', date: TODAY, tasks: [task(1, 'Write report')] };
  apiMod.api.mockImplementation(() => new Promise(() => {})); // request still pending
  const r = render(<DailyCheckinCard msg={msg(p1)} t={dark} time="18:00" meId={7} today={TODAY} />);
  fireEvent.press(r.getByTestId('done-1'));
  expect(r.getAllByTestId('pill-done')).toHaveLength(1);
  r.rerender(<DailyCheckinCard msg={msg({ ...p1, tasks: [task(1, 'Write report')] })} t={dark} time="18:00" meId={7} today={TODAY} />);
  expect(r.queryByTestId('pill-done')).toBeNull(); // server says still open (e.g. someone undid it)
});

test('admins\' summary: totals, who replied, picks, done and the report', () => {
  const r = card({
    kind: 'summary', date: TODAY, totals: { members: 2, replied: 1, done: 1, picked: 1 },
    members: [
      { id: 1, name: 'Anubhav', replied: true, picks: [{ id: 2, title: 'Fix login', status: 'todo' }], done: [{ id: 1, title: 'Write report' }], morning: null, report: 'Finished the report', open: 1 },
      { id: 2, name: 'Tushar', replied: false, picks: [], done: [], morning: null, report: null, open: 3 },
    ],
  });
  expect(r.getByText('Check-in summary')).toBeTruthy();
  expect(r.getByText('1 of 2 replied · 1 done today · 1 picked for today')).toBeTruthy();
  expect(r.getByText('REPLIED')).toBeTruthy();
  expect(r.getByText('NO REPLY')).toBeTruthy();
  expect(r.getByText(/Fix login/)).toBeTruthy();
  expect(r.getByText(/Write report/)).toBeTruthy();
  expect(r.getByText(/Finished the report/)).toBeTruthy();
  expect(r.queryByTestId('checkin-reply')).toBeNull();
});

test('pill colours are distinct', () => {
  expect(new Set([PILL.done.color, PILL.today.color, PILL.open.color]).size).toBe(3);
});
