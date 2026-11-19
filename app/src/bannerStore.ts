// Tiny store for the in-app top banner (push.ts shows it while the app is open; InAppBanner renders it).
export type Banner = { id: number; chatId: number; title: string; body: string; messageId?: number | null };

let current: Banner | null = null;
let seq = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const subscribeBanner = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getBanner = () => current;

export function showBanner(b: Omit<Banner, 'id'>) {
  current = { ...b, id: ++seq };
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBanner, 5000);
  emit();
}

export function hideBanner() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!current) return;
  current = null;
  emit();
}

// Hosts: a root host (App.tsx) wins over the local one inside ChatScreen, so the banner never shows twice.
let rootHosts = 0;
const hostSubs = new Set<() => void>();
export const subscribeHosts = (f: () => void) => { hostSubs.add(f); return () => { hostSubs.delete(f); }; };
export const hasRootHost = () => rootHosts > 0;
export function registerRootHost() {
  rootHosts++;
  hostSubs.forEach((f) => f());
  return () => { rootHosts--; hostSubs.forEach((f) => f()); };
}
