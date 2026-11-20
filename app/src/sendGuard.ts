// Double-tap Send guard: the same text within this window is the same tap, not a second message.
export const SEND_DEBOUNCE_MS = 300;
export function shouldSend(last: { text: string; at: number } | null, body: string, now: number): boolean {
  if (!body.trim()) return false;
  return !(last && last.text === body && now - last.at < SEND_DEBOUNCE_MS);
}
