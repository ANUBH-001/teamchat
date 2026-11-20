// Fuzzy person matching for Hindi / English / Hinglish names ("anubhav", "Anubhav ji", "अनुभव", "anubav", "rishith").
// Devanagari -> rough Latin. Tiers per word: exact > prefix > fuzzy (consonant skeleton or Damerau-Levenshtein
// <= 1 for short names, <= 2 for longer, same first letter). Every query word must match; +0.5 when the query covers
// every part of the name (so "anubhav" picks "Anubhav" over "Anubhav Kumar"). Shared by commands, mentions, AI.

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
const STOP = new Set(['ko', 'ka', 'ki', 'ke', 'ji', 'bhai', 'sir', 'madam', 'mam', 'se', 'ne', 'to', 'the', 'tumko', 'tujhe',
  'tumhe', 'aapko']);

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

// Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps).
function dl(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// 3 exact, 2 prefix, 1.5 same consonant skeleton, 1 small typo (same first letter), 0 no match.
function tier(q, n) {
  if (q === n) return 3;
  if (q.length >= 3 && n.startsWith(q)) return 2;
  if (q.length >= 3 && q[0] === n[0]) {
    if (skeleton(q) === skeleton(n)) return 1.5; // same sounds ("rishith" -> Rishit) beats a typo-distance match (Rishabh)
    if (q.length >= 4 && dl(q, n) <= (Math.max(q.length, n.length) <= 5 ? 1 : 2)) return 1; // typos only for words of 4+ letters (not "E2E", "fix")
  }
  return 0;
}

function score(qTokens, name) {
  const nTokens = tokens(name);
  let total = 0;
  const hit = new Set();
  for (const q of qTokens) {
    let best = 0; let at = -1;
    nTokens.forEach((n, i) => { const t = tier(q, n); if (t > best) { best = t; at = i; } });
    if (!best) return 0; // every query word must match some part of the name
    total += best;
    hit.add(at);
  }
  // small bonus when the query covers the whole name: "anubhav" -> "Anubhav" beats "Anubhav Kumar"
  return total + (hit.size === nTokens.length ? 0.5 : 0);
}

// -> {people: best-matching people (empty = none, more than one = ambiguous), score (higher = better)}
function bestMatches(query, people) {
  const q = tokens(query);
  if (!q.length) return { people: [], score: 0 };
  let best = 0; let out = [];
  for (const p of people) {
    const s = score(q, p.name);
    if (s > best) { best = s; out = [p]; } else if (s && s === best) out.push(p);
  }
  return { people: out, score: best };
}
const matchPeople = (query, people) => bestMatches(query, people).people;

// Structured mentions: the app sends mentionIds (in text order) for every "@Name" it inserted from a picker.
// Each "@token" in the text takes the first unused id whose name matches it.
// -> [{token (lower case, no @), id}] in text order. users = [{id, name}] for those ids.
const MENTION_RE = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{M}\p{N}_.-]+)/gu;
const cleanToken = (w) => String(w || '').replace(/^@/, '').replace(/[.,:;!?_-]+$/, '').toLowerCase();
function tagMentions(text, ids, users) {
  const out = [];
  if (!ids || !ids.length) return out;
  const byId = new Map(users.map((u) => [u.id, u]));
  const left = ids.filter((id) => byId.has(id));
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const token = cleanToken(m[2]);
    if (!token) continue;
    const i = left.findIndex((id) => score(tokens(token), byId.get(id).name) > 0);
    if (i < 0) continue;
    out.push({ token, id: left[i] });
    left.splice(i, 1);
  }
  return out;
}

module.exports = { matchPeople, bestMatches, tagMentions, cleanToken, MENTION_RE };
