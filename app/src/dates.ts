import { Share } from 'react-native';
import { toast } from './useVoiceInput';

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
