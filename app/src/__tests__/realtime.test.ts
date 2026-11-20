jest.mock('../api', () => ({ getToken: jest.fn() }));
jest.mock('../sessionStore', () => ({ kick: jest.fn() }));
jest.mock('../updateStore', () => ({ markUpdateRequired: jest.fn() }));

class FakeWS {
  static all: FakeWS[] = [];
  readyState = 0; sent: string[] = [];
  onopen: any; onmessage: any; onclose: any; onerror: any;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  msg(o: any) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
}
(global as any).WebSocket = FakeWS;

import { getToken } from '../api';
import { startRealtime, stopRealtime, onEvent } from '../realtime';

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  FakeWS.all = [];
  (getToken as jest.Mock).mockReset().mockResolvedValue('tok');
});
afterEach(() => { stopRealtime(); jest.useRealTimers(); });

test('sends a ping every 25 s while open', async () => {
  startRealtime(); await flush();
  const ws = FakeWS.all[0]; ws.open();
  jest.advanceTimersByTime(25000);
  expect(ws.sent).toEqual(['{"type":"ping"}']);
  ws.msg({ type: 'x' });
  jest.advanceTimersByTime(25000);
  expect(ws.sent.length).toBe(2);
});

test('pong is not forwarded to listeners, other events are', async () => {
  const got: any[] = []; const off = onEvent((e) => got.push(e));
  startRealtime(); await flush();
  const ws = FakeWS.all[0]; ws.open();
  ws.msg({ type: 'pong', t: 1 }); ws.msg({ type: 'message', n: 1 });
  jest.advanceTimersByTime(100);
  expect(got.map((e) => e.type)).toEqual(['_open', 'message']);
  off();
});

test('no inbound traffic for 60 s closes and reconnects', async () => {
  startRealtime(); await flush();
  const ws = FakeWS.all[0]; ws.open();
  jest.advanceTimersByTime(66000);
  expect(ws.readyState).toBe(3);
  jest.advanceTimersByTime(20000); await flush();
  expect(FakeWS.all.length).toBe(2);
});

test('traffic keeps the socket alive past 60 s', async () => {
  startRealtime(); await flush();
  const ws = FakeWS.all[0]; ws.open();
  for (let i = 0; i < 4; i++) { jest.advanceTimersByTime(20000); ws.msg({ type: 'pong', t: 1 }); }
  expect(ws.readyState).toBe(1);
  expect(FakeWS.all.length).toBe(1);
});

test('stop during a pending getToken opens no socket', async () => {
  let res: (t: string) => void = () => {};
  (getToken as jest.Mock).mockReturnValue(new Promise<string>((r) => { res = r; }));
  startRealtime();
  stopRealtime();
  res('tok'); await flush();
  expect(FakeWS.all.length).toBe(0);
});

test('rapid stop/start leaves exactly one socket', async () => {
  const resolvers: Array<(t: string) => void> = [];
  (getToken as jest.Mock).mockImplementation(() => new Promise<string>((r) => resolvers.push(r)));
  startRealtime(); stopRealtime(); startRealtime();
  resolvers.forEach((r) => r('tok')); await flush();
  expect(FakeWS.all.length).toBe(1);
});

test('stopRealtime resets the ?token= fallback', async () => {
  startRealtime(); await flush();
  FakeWS.all[0].onclose({ code: 4401 }); // header not delivered -> query fallback
  jest.advanceTimersByTime(600); await flush();
  expect(FakeWS.all[1].url).toContain('token=');
  stopRealtime();
  startRealtime(); await flush();
  expect(FakeWS.all[2].url).not.toContain('token=');
});
