import { getToken } from './api';
import { SERVER_URL } from './config';
import { VERSION_CODE } from './version';
import { kick } from './sessionStore';
import { markUpdateRequired } from './updateStore';

type Listener = (e: any) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let running = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
// token goes in the Authorization header (kept out of proxy logs). If the header is not delivered on some device the
// server answers 4401 before we ever connected: retry once with the old ?token= query before treating it as a logout.
let headerWorked = false;
let useQuery = false;

const emit = (e: any) => listeners.forEach((l) => l(e));

// Bursts (bulk task updates, many cards at once) are coalesced: socket events are queued and flushed every ~50 ms in
// one go, so React batches the setState calls of all listeners into one render. Order is kept; listeners still get
// events one by one.
let queue: any[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flushQueue() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const q = queue;
  queue = [];
  for (const e of q) { try { emit(e); } catch (err) {} }
}
const queueEvent = (e: any) => {
  queue.push(e);
  if (!flushTimer) flushTimer = setTimeout(flushQueue, 50);
};
// connection events go out at once, after anything still queued (keeps the order)
const emitNow = (e: any) => { flushQueue(); emit(e); };

export const emitEvent = emit; // for local synthetic events (e.g. notification tap)

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function connect() {
  if (!running) return;
  const token = await getToken();
  if (!token || !running) return;
  const base = SERVER_URL.replace(/^http/, 'ws') + '/?v=' + VERSION_CODE;
  // RN's WebSocket takes a 3rd options arg with headers (not in the DOM typings)
  const sock: WebSocket = useQuery
    ? new WebSocket(base + '&token=' + encodeURIComponent(token))
    : new (WebSocket as any)(base, null, { headers: { Authorization: 'Bearer ' + token } });
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    if (!useQuery) headerWorked = true;
    emitNow({ type: '_open' }); // screens fetch missed messages + flush the outbox
  };
  sock.onmessage = (m) => {
    try { queueEvent(JSON.parse(String(m.data))); } catch (e) {}
  };
  sock.onclose = (e: any) => {
    if (ws === sock) ws = null;
    emitNow({ type: '_close' });
    if (!running) return;
    const code = e && e.code;
    // 4409 = logged in on another phone; 4401 = token rejected / logged out by admin; 4426 = app too old. No reconnect loop.
    if (code === 4409) { running = false; kick('replaced'); return; }
    if (code === 4401) {
      if (!headerWorked && !useQuery) { useQuery = true; timer = setTimeout(connect, 500); return; }
      running = false; kick('logged_out'); return;
    }
    if (code === 4426) { running = false; markUpdateRequired(); return; }
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
  };
  sock.onerror = () => { try { sock.close(); } catch (e) {} };
}

export function startRealtime() {
  if (running) return;
  running = true;
  connect();
}

export function stopRealtime() {
  running = false;
  if (timer) clearTimeout(timer);
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  queue = []; // logout: drop what the old session still had queued
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

export function sendTyping(chatId: number) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'typing', chatId }));
}
