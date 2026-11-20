// dates.ts pulls in useVoiceInput (native speech module) which has no JS implementation under Jest
jest.mock('../useVoiceInput', () => ({ toast: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChecklistCard, CHECKLIST_LINES } from '../components/KeepViews';
import { Line } from '../taskFormat';

const line = (id: number, title: string, userId: number, done = false): Line => ({
  task: { id, title, status: done ? 'done' : 'todo', assignees: [] } as any, userId, name: 'Anubhav', done, doneAt: done ? '2026-11-20T10:00:00Z' : null, others: 0,
} as any);

test('renders title and open task titles, truncated to 3 lines', () => {
  const { getByText, getByTestId, queryByText } = render(
    <ChecklistCard title="Anubhav tasks" lines={[line(1, 'First task', 7), line(2, 'Second', 7), line(3, 'Finished', 7, true)]} me={7} isBoss={false} onTick={jest.fn()} onOpen={jest.fn()} />,
  );
  expect(getByText('Anubhav tasks')).toBeTruthy();
  expect(getByText('First task')).toBeTruthy();
  expect(queryByText('Finished')).toBeNull(); // ticked ones leave the card
  expect(getByTestId('title-1').props.numberOfLines).toBe(CHECKLIST_LINES);
  expect(CHECKLIST_LINES).toBe(3);
});

test('tapping the checkbox ticks that task; tapping the text opens it', () => {
  const onTick = jest.fn(); const onOpen = jest.fn();
  const { getByTestId } = render(<ChecklistCard title="A tasks" lines={[line(1, 'First', 7), line(2, 'Second', 7)]} me={7} isBoss={false} onTick={onTick} onOpen={onOpen} />);
  fireEvent.press(getByTestId('tick-2'));
  expect(onTick).toHaveBeenCalledTimes(1);
  expect(onTick.mock.calls[0][0].task.id).toBe(2);
  fireEvent.press(getByTestId('title-1'));
  expect(onOpen.mock.calls[0][0].task.id).toBe(1);
});

test('a member cannot tick someone else, the boss can', () => {
  const onTick = jest.fn();
  const l = [line(1, 'Theirs', 9)];
  const m = render(<ChecklistCard title="X" lines={l} me={7} isBoss={false} onTick={onTick} onOpen={jest.fn()} />);
  fireEvent.press(m.getByTestId('tick-1'));
  expect(onTick).not.toHaveBeenCalled();
  const b = render(<ChecklistCard title="X" lines={l} me={7} isBoss onTick={onTick} onOpen={jest.fn()} />);
  fireEvent.press(b.getByTestId('tick-1'));
  expect(onTick).toHaveBeenCalledTimes(1);
});

test('done mode shows only done lines, struck through', () => {
  const { getByText, queryByText } = render(<ChecklistCard done title="X" lines={[line(1, 'Open', 7), line(2, 'Fin', 7, true)]} me={7} isBoss={false} onTick={jest.fn()} onOpen={jest.fn()} />);
  expect(queryByText('Open')).toBeNull();
  expect(getByText('Fin').props.style.textDecorationLine).toBe('line-through');
});
