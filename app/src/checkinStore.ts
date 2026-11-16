import { api } from './api';
import { CheckinToday } from './chatTypes';
import { applyCheckinSchedule } from './push';

// Member's GET /checkins/today, shared by every check-in card (one request at a time, tiny cache).
let cache: { at: number; data: CheckinToday } | null = null;
let inflight: Promise<CheckinToday> | null = null;
const subs = new Set<(d: CheckinToday) => void>();

export const onCheckinToday = (fn: (d: CheckinToday) => void) => {
  subs.add(fn);
  return () => { subs.delete(fn); };
};

export const peekCheckinToday = () => cache?.data ?? null;

export function clearCheckinToday() {
  cache = null;
}

// `force` skips the 5 s cache. Also keeps the phone reminders in sync with the server settings.
export function loadCheckinToday(force = false): Promise<CheckinToday> {
  if (!force && cache && Date.now() - cache.at < 5000) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = api<CheckinToday>('GET', '/checkins/today')
    .then((d) => {
      cache = { at: Date.now(), data: d };
      applyCheckinSchedule(d.settings, d.chatId);
      subs.forEach((f) => f(d));
      return d;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
