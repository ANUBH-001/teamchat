import React from 'react';
import { Linking, Text, TextStyle } from 'react-native';
import { dark, Theme } from '../theme';

// Message text with links, phone numbers and @mentions. Mentions of me are highlighted stronger.
// split() with one capture group: odd indexes are the matches.
const RE = /(https?:\/\/\S+|www\.\S+|\+?\d[\d\s-]{8,13}\d|@[\p{L}\p{N}_]+)/u;

function open(kind: 'url' | 'tel', v: string) {
  const url = kind === 'tel' ? 'tel:' + v.replace(/[\s-]/g, '') : /^https?:/i.test(v) ? v : 'https://' + v;
  Linking.openURL(url).catch(() => {});
}

function RichTextBase({ text, t, style, meName, mine }: { text: string; t: Theme; style?: TextStyle; meName: string; mine?: boolean }) {
  // on my own (green) bubble the green accent has too little contrast: use a link blue there
  const mentionColor = mine ? (t.background === dark.background ? '#53BDEB' : '#027EB5') : t.accent;
  const parts = text.split(RE);
  const me = meName.trim().split(/\s+/)[0].toLowerCase();
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (!p) return null;
        if (i % 2 === 0) return p;
        if (p[0] === '@') {
          const forMe = p.slice(1).toLowerCase() === me;
          return (
            <Text key={i} style={{ fontWeight: '700', color: mentionColor, backgroundColor: forMe ? 'rgba(37,211,102,0.22)' : undefined }}>{p}</Text>
          );
        }
        const kind = /^\+?\d/.test(p) ? 'tel' : 'url';
        const link = kind === 'tel' ? p : p.replace(/[.,;:!?)]+$/, '');
        const tail = kind === 'tel' ? '' : p.slice(link.length);
        return (
          <Text key={i}>
            <Text onPress={() => open(kind, link)} style={{ color: '#2E8BDB', textDecorationLine: 'underline' }}>{link}</Text>
            {tail}
          </Text>
        );
      })}
    </Text>
  );
}
export default React.memo(RichTextBase);
