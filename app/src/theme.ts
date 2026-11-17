export const light = {
  primary: '#075E54',
  accent: '#25D366',
  bubbleOut: '#DCF8C6',
  bubbleIn: '#FFFFFF',
  background: '#ECE5DD',
  card: '#FFFFFF',
  text: '#111B21',
  subtext: '#667781',
  border: '#E9EDEF',
  soft: '#F0F2F5',
  danger: '#E53935',
};

export const dark = {
  primary: '#1F2C34',
  accent: '#00A884',
  bubbleOut: '#005C4B',
  bubbleIn: '#202C33',
  background: '#0B141A',
  card: '#111B21',
  text: '#E9EDEF',
  subtext: '#8696A0',
  border: '#222D34',
  soft: '#1A252C',
  danger: '#EF5350',
};

export type Theme = typeof light;

export const tickRead = '#53BDEB';
// 12 well-separated hues so an 11-person team rarely collides.
export const senderColors = [
  '#E5484D', '#F76B15', '#C99A06', '#7FA200', '#30A46C', '#12A594',
  '#00A2C7', '#0091FF', '#5B5BD6', '#8E4EC6', '#D6409F', '#A18072',
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
