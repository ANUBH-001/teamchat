// "Logged in on another phone" (one login per user): api.ts on 401 SESSION_REPLACED and realtime.ts on ws close
// 4409 (or 4401 = logged out by admin / deactivated) call kick(); AuthProvider listens, shows the message and logs out.
type Listener = (reason: 'replaced' | 'logged_out') => void;
const subs = new Set<Listener>();
let kicked = false;

export function kick(reason: 'replaced' | 'logged_out') {
  if (kicked) return;
  kicked = true;
  subs.forEach((f) => f(reason));
}
export const resetKick = () => { kicked = false; };
export function onKick(f: Listener) {
  subs.add(f);
  return () => { subs.delete(f); };
}
