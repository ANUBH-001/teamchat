import { getToken } from './api';
import { SERVER_URL } from './config';

type Listener = (e: any) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let running = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const emit = (e: any) => listeners.forEach((l) => l(e));

export const emitEvent = emit; // for local synthetic events (e.g. notification tap)

export function onEvent(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function connect() {
  if (!running) return;
  const token = await getToken();
  if (!token || !running) return;
  const sock = new WebSocket(SERVER_URL.replace(/^http/, 'ws') + '/?token=' + encodeURIComponent(token));
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    emit({ type: '_open' }); // screens fetch missed messages + flush the outbox
  };
  sock.onmessage = (m) => {
    try { emit(JSON.parse(String(m.data))); } catch (e) {}
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    emit({ type: '_close' });
    if (!running) return;
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
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
}

export function sendTyping(chatId: number) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'typing', chatId }));
}
