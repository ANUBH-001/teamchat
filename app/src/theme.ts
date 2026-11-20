// Round 4: "Midnight Violet" theme (solid accent, no gradient). Old token names kept so old components compile.
// `header` = top-bar background (white text on it); `primary` is the accent-like text/link color.
export const light = {
  primary: '#6C4CF5',
  accent: '#6C4CF5',
  accent2: '#6C4CF5', // sender names / links
  header: '#6C4CF5',
  onAccent: '#FFFFFF', // text/icons on accent, bubbleOut, header
  bubbleOut: '#6C4CF5',
  bubbleOutText: '#FFFFFF',
  bubbleIn: '#EEEBFA',
  background: '#FAFAFF',
  wallpaper: '#FAFAFF',
  card: '#FFFFFF',
  surface: '#F0EEFB',
  soft: '#F0EEFB',
  chip: '#E5DFFF',
  chipText: '#4A2FD0',
  text: '#14121F',
  subtext: '#6C6884',
  border: '#E4E1F2',
  tickRead: '#6C4CF5',
  danger: '#E5484D',
};

export const dark: typeof light = {
  primary: '#9C85FF',
  accent: '#9C85FF',
  accent2: '#B4A3FF',
  header: '#1A1730',
  onAccent: '#FFFFFF',
  bubbleOut: '#6C4CF5',
  bubbleOutText: '#FFFFFF',
  bubbleIn: '#221E3B',
  background: '#0E0C1A',
  wallpaper: '#0E0C1A',
  card: '#141226',
  surface: '#1A1730',
  soft: '#1A1730',
  chip: '#2E2760',
  chipText: '#DCD3FF',
  text: '#EEEBFF',
  subtext: '#9590B5',
  border: '#2A2645',
  tickRead: '#9C85FF',
  danger: '#FF6369',
};

export type Theme = typeof light;

export const tickRead = '#9C85FF';
// Ticks on MY (violet) bubble: light colors so they stay visible on the accent.
export const tickReadOnBubble = '#8FE9FF';
export const tickOnBubble = 'rgba(255,255,255,0.7)';
// 12 well-separated mid-tone hues (readable as name text on light + dark bubbles, and as avatar fills with white text).
export const senderColors = [
  '#E0475B', '#E8702A', '#B8860B', '#6E9B00', '#2E9E6B', '#0F9D94',
  '#0A8FB5', '#2F7DE1', '#8A5CE6', '#B84FC9', '#D6409F', '#A0765F',
];
export const colorFor = (id: number) => senderColors[Math.abs(id) % senderColors.length];

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// Subtle solid bubble tint: the sender color mixed into the normal incoming bubble color.
export function tintFor(id: number, isDark: boolean) {
  const c = rgb(colorFor(id));
  const base = rgb(isDark ? dark.bubbleIn : light.bubbleIn);
  const k = isDark ? 0.2 : 0.13;
  return '#' + c.map((v, i) => Math.round(v * k + base[i] * (1 - k)).toString(16).padStart(2, '0')).join('');
}

// Round 4: bottom tab bar style (App.tsx); ChatsScreen hides the bar inside a chat like WhatsApp
export const tabBarStyleFor = (t: Theme) => ({ backgroundColor: t.card, borderTopColor: t.border, height: 64, paddingBottom: 8, paddingTop: 6 });
