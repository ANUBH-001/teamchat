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
};

export type Theme = typeof light;

export const tickRead = '#53BDEB';
export const senderColors = ['#E17076', '#7BC862', '#E5CA77', '#65AADD', '#A695E7', '#EE7AAE', '#6EC9CB', '#FAA774'];
export const colorFor = (id: number) => senderColors[Math.abs(id) % senderColors.length];
