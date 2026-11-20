import { AppState } from 'react-native';
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

// Connection generation: bumped by start/stop and by every reconnect decision, so an async connect() that was overtaken
// (stop during `await getToken()`, rapid stop/start) aborts, and handlers of old sockets are ignored.
let gen = 0;
// Heartbeat: client pings every 25 s (server answers {type:'pong'}); no inbound message of any kind for 60 s = dead
// socket (e.g. after a network change) -> close and reconnect. An old server that ignores ping sends nothing on an idle
// chat, so such a chat reconnects about every 60 s; harmless (reconnect fetches missed messages) and goes away once the
// server answers pings.
export const PING_MS = 25000;
export const DEAD_MS = 60000;
const WATCH_MS = 5000;
let lastRx = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let watchTimer: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}
function startHeartbeat(sock: WebSocket) {
  stopHeartbeat();
  lastRx = Date.now();
  pingTimer = setInterval(() => {
    if (ws === sock && sock.readyState === 1) { try { sock.send('{"type":"ping"}'); } catch (e) {} }
  }, PING_MS);
  watchTimer = setInterval(() => {
    if (ws === sock && Date.now() - lastRx > DEAD_MS) dropAndReconnect(sock);
  }, WATCH_MS);
}

function scheduleConnect(delay: number) {
  if (timer) clearTimeout(timer);
  const g = gen;
  timer = setTimeout(() => { timer = null; connect(g); }, delay);
}
function scheduleReconnect() {
  retry = Math.min(retry + 1, 6);
  const base = Math.min(1000 * 2 ** retry, 15000);
  scheduleConnect(Math.round(base * (0.7 + Math.random() * 0.6))); // jitter: don't reconnect in lockstep
}

// Socket looks dead: abandon it (its late events are ignored) and reconnect.
function dropAndReconnect(sock: WebSocket) {
  if (ws !== sock) return;
  ws = null;
  gen++;
  stopHeartbeat();
  try { sock.close(); } catch (e) {}
  emitNow({ type: '_close' });
  if (running) scheduleReconnect();
}

async function connect(myGen: number) {
  if (!running || myGen !== gen) return;
  if (timer) { clearTimeout(timer); timer = null; }
  const token = await getToken();
  if (!token || !running || myGen !== gen) return; // stopped / superseded while fetching the token
  if (ws) { const old = ws; ws = null; stopHeartbeat(); try { old.close(); } catch (e) {} }
  const base = SERVER_URL.replace(/^http/, 'ws') + '/?v=' + VERSION_CODE;
  // RN's WebSocket takes a 3rd options arg with headers (not in the DOM typings)
  const sock: WebSocket = useQuery
    ? new WebSocket(base + '&token=' + encodeURIComponent(token))
    : new (WebSocket as any)(base, null, { headers: { Authorization: 'Bearer ' + token } });
  ws = sock;
  const stale = () => ws !== sock || myGen !== gen;
  sock.onopen = () => {
    if (stale()) return;
    retry = 0;
    if (!useQuery) headerWorked = true;
    startHeartbeat(sock);
    emitNow({ type: '_open' }); // screens fetch missed messages + flush the outbox
  };
  sock.onmessage = (m) => {
    if (stale()) return;
    lastRx = Date.now();
    try {
      const e = JSON.parse(String(m.data));
      if (e && e.type === 'pong') return; // heartbeat reply, not for listeners
      queueEvent(e);
    } catch (err) {}
  };
  sock.onclose = (e: any) => {
    if (stale()) return;
    ws = null;
    stopHeartbeat();
    emitNow({ type: '_close' });
    if (!running) return;
    const code = e && e.code;
    // 4409 = logged in on another phone; 4401 = token rejected / logged out by admin; 4426 = app too old. No reconnect loop.
    if (code === 4409) { running = false; kick('replaced'); return; }
    if (code === 4401) {
      if (!headerWorked && !useQuery) { useQuery = true; scheduleConnect(500); return; }
      running = false; kick('logged_out'); return;
    }
    if (code === 4426) { running = false; markUpdateRequired(); return; }
    scheduleReconnect();
  };
  sock.onerror = () => { if (!stale()) { try { sock.close(); } catch (err) {} } };
}

export function startRealtime() {
  if (running) return;
  running = true;
  gen++;
  connect(gen);
}

export function stopRealtime() {
  running = false;
  gen++; // any connect() still awaiting its token aborts; old socket handlers become no-ops
  useQuery = false; // A-16: the ?token= fallback must not stick across logins
  headerWorked = false;
  retry = 0;
  stopHeartbeat();
  if (timer) { clearTimeout(timer); timer = null; }
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  queue = []; // logout: drop what the old session still had queued
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

// Coming back to the foreground: sockets die silently while backgrounded / after a network change. Check right away.
AppState.addEventListener('change', (st) => {
  if (st !== 'active' || !running) return;
  const sock = ws;
  if (!sock || sock.readyState > 1) { retry = 0; gen++; connect(gen); return; }
  if (sock.readyState === 1) {
    if (Date.now() - lastRx > DEAD_MS) dropAndReconnect(sock);
    else { try { sock.send('{"type":"ping"}'); } catch (e) {} }
  }
});

export function sendTyping(chatId: number) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'typing', chatId }));
}
