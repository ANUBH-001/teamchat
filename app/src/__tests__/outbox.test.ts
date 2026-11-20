import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../api';

jest.mock('../api', () => {
  class ApiError extends Error { status: number; code?: string; constructor(m: string, s: number, c?: string) { super(m); this.status = s; this.code = c; } }
  return { api: jest.fn(), ApiError };
});
import { api } from '../api';
import { enqueue, flushOutbox, onFailed, onSent, pendingFor, removeFromOutbox, _resetOutboxForTests } from '../outbox';

const mockApi = api as jest.Mock;
const stored = async () => JSON.parse((await AsyncStorage.getItem('outbox')) || '[]');
const msg = (clientId: string) => ({ message: { clientId, id: 1 } });
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  mockApi.mockReset();
  await AsyncStorage.clear();
  _resetOutboxForTests();
});

test('enqueue during a flush never loses items', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  mockApi.mockImplementation(async (_m: string, _p: string, body: any) => { if (body.clientId === 'a') await gate; return msg(body.clientId); });
  await enqueue(1, 'a', 'a', 'now');
  await settle(); // flush is blocked on 'a'
  await Promise.all([enqueue(1, 'b', 'b', 'now'), enqueue(1, 'c', 'c', 'now'), removeFromOutbox('zzz')]);
  release();
  await settle(); await settle();
  expect(mockApi.mock.calls.map((c) => c[2].clientId).sort()).toEqual(['a', 'b', 'c']);
  expect(await stored()).toEqual([]);
});

test('concurrent enqueue and remove keep the other items', async () => {
  mockApi.mockImplementation(() => new Promise(() => {})); // never completes
  await enqueue(1, 'a', 'a', 'now');
  await Promise.all([enqueue(1, 'b', 'b', 'now'), removeFromOutbox('a'), enqueue(1, 'c', 'c', 'now')]);
  expect((await stored()).map((i: any) => i.clientId)).toEqual(['b', 'c']);
});

test('message enqueued mid-flush is sent without waiting for the next timer', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  mockApi.mockImplementation(async (_m: string, _p: string, body: any) => { if (body.clientId === 'a') await gate; return msg(body.clientId); });
  await enqueue(1, 'a', 'a', 'now');
  await settle();
  await enqueue(1, 'b', 'b', 'now');
  release();
  await settle(); await settle();
  expect(mockApi.mock.calls.map((c) => c[2].clientId)).toEqual(['a', 'b']);
});

test.each([[426], [500], [503], [0], [401], [429]])('status %i keeps the item queued', async (status) => {
  mockApi.mockRejectedValue(new ApiError('x', status));
  await enqueue(1, 'a', 'a', 'now');
  await settle();
  const items = await stored();
  expect(items).toHaveLength(1);
  expect(items[0].failed).toBeFalsy();
});

test('other 4xx marks the item failed, notifies, and stops retrying it', async () => {
  mockApi.mockRejectedValue(new ApiError('not a member', 403));
  const failed = jest.fn(); const off = onFailed(failed);
  await enqueue(1, 'a', 'a', 'now');
  await settle();
  expect(failed).toHaveBeenCalledWith('a');
  const items = await stored();
  expect(items[0].failed).toBe(true);
  mockApi.mockClear();
  await flushOutbox();
  expect(mockApi).not.toHaveBeenCalled();
  const p = await pendingFor(1, 9, 'me');
  expect(p[0]).toMatchObject({ failed: true, pending: false });
  off();
});

test('sent listener fires and item is removed on success', async () => {
  mockApi.mockResolvedValue(msg('a'));
  const sent = jest.fn(); const off = onSent(sent);
  await enqueue(1, 'a', 'a', 'now');
  await settle();
  expect(sent).toHaveBeenCalledTimes(1);
  expect(await stored()).toEqual([]);
  off();
});
