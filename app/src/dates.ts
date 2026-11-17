import { Share } from 'react-native';
import { toast } from './useVoiceInput';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> "Today" / "Tomorrow" / "Yesterday" / "18 Nov" (+ year when not the current year)
export function formatDue(ymd?: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return d + ' ' + MONTHS[m - 1] + (y !== now.getFullYear() ? ' ' + y : '');
}

// Copy to clipboard; falls back to the share sheet when the native module is missing (older dev build).
export function copyText(text: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const C = require('expo-clipboard');
    Promise.resolve(C.setStringAsync(text)).then(() => toast('Copied')).catch(() => Share.share({ message: text }).catch(() => {}));
  } catch {
    Share.share({ message: text }).catch(() => {});
  }
}
