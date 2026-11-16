// Fuzzy person matching for Hindi / English / Hinglish names ("anubhav", "Anubhav ji", "अनुभव").
// Devanagari is transliterated to rough Latin, then compared exactly, by consonant skeleton, or by prefix.

const DEV = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri',
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri',
  'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};
const STOP = new Set(['ko', 'ka', 'ki', 'ke', 'ji', 'bhai', 'sir', 'madam', 'mam', 'se', 'ne', 'to', 'the']);

function latin(s) {
  return [...String(s || '').toLowerCase()].map((c) => (DEV[c] !== undefined ? DEV[c] : c)).join('');
}
const tokens = (s) => latin(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

// Keep the first letter, drop vowels and 'h' after a consonant, unify common spellings, collapse doubles.
function skeleton(w) {
  const s = w.replace(/ph|f/g, 'p').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/c(?!h)/g, 'k');
  let out = s[0] || '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if ('aeiou'.includes(c)) continue;
    if (c === 'h' && !'aeiou'.includes(s[i - 1])) continue;
    out += c;
  }
  return out.replace(/(.)\1+/g, '$1');
}

function score(qTokens, name) {
  const nTokens = tokens(name);
  let total = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const n of nTokens) {
      if (q === n) best = Math.max(best, 3);
      else if (q.length >= 2 && skeleton(q) === skeleton(n)) best = Math.max(best, 2);
      else if (q.length >= 3 && n.startsWith(q)) best = Math.max(best, 1);
    }
    total += best;
  }
  return total;
}

// Returns the best-matching people (empty = no match, more than one = ambiguous).
function matchPeople(query, people) {
  const q = tokens(query);
  if (!q.length) return [];
  let best = 0; let out = [];
  for (const p of people) {
    const s = score(q, p.name);
    if (s > best) { best = s; out = [p]; } else if (s && s === best) out.push(p);
  }
  return out;
}

module.exports = { matchPeople };
