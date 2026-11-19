// Task status keys (round 3). One place for the list, order, labels, old-key aliases and note keywords.
// Per-person status lives in task_assignees.status; tasks.status is the aggregate (lowest step of the active assignees,
// 'done' only when all are done) or 'closed' (close replaces delete). App mirror: app/src/taskTypes.ts.
const STATUSES = ['todo', 'planning', 'coding', 'testing', 'change_merged', 'done'];
const ALL = [...STATUSES, 'closed'];
const RANK = { todo: 0, planning: 1, coding: 2, testing: 3, change_merged: 4, done: 5 };
const LABEL = {
  todo: 'Todo', planning: 'Planning', coding: 'Coding', testing: 'Testing', change_merged: 'Change merged', done: 'Done', closed: 'Closed',
  in_progress: 'Coding', review: 'Testing', // old keys in old card payloads / sign-off JSON
};
// accepted on input from old clients, commands and the AI
const ALIAS = {
  in_progress: 'coding', review: 'testing', doing: 'coding', start: 'coding', progress: 'coding', merged: 'change_merged',
  merge: 'change_merged', 'change-merged': 'change_merged', changemerged: 'change_merged', plan: 'planning', test: 'testing',
  complete: 'done', completed: 'done',
};

// Any input -> a STATUSES key, or null. ('closed' is not a status you set; use close/reopen.)
function norm(s) {
  const k = String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '_');
  if (STATUSES.includes(k)) return k;
  return ALIAS[k] || ALIAS[k.replace(/_/g, '-')] || null;
}

const isOpen = (s) => s !== 'done' && s !== 'closed';

// Aggregate of per-person statuses (closed is handled by the caller).
function aggregate(list) {
  const s = list.filter((x) => RANK[x] !== undefined);
  if (!s.length) return 'todo';
  if (s.every((x) => x === 'done')) return 'done';
  return s.filter((x) => x !== 'done').sort((a, b) => RANK[a] - RANK[b])[0];
}

// Keywords in a note / reply -> status (deterministic; check order matters).
const MERGED_RE = /(\bmerged?\b|merge\s*(ho|kar|kr)\s*(gaya|gayi|gya|diya|di|liya)|pr\s*merge|main\s*(me|mein|में)\s*merge|मर्ज)/i;
const TESTING_RE = /(testing|test\s*(baaki|baki|pending|karna|krna|kar\s*lo|kr\s*lo|kijiye)|\breview\b|\bqa\b|check\s*(kar|kr)\s*(lo|lijiye|lena|do)|टेस्टिंग|टेस्ट)/i;
const DONE_RE = /(ho gaya|ho gayi|ho gya|ho gyi|ho gai|hogaya|hogayi|kar diya|kar di|kar liya|complete|completed|\bdone\b|finished|khatam|हो गया|हो गई|हो गयी|कर दिया|कर दी|पूरा|खत्म)/i;
const PLANNING_RE = /(\bplan\b|planning|plan\s*kar\s*(raha|rahi)|soch\s*(raha|rahi)|design\s*kar|approach|प्लान)/i;
const CODING_RE = /(shuru|\bstart|started|kar raha|kar rahi|working on|in progress|chal raha|coding|code\s*kar|develop|bana\s*(raha|rahi)|शुरू|कर रहा|कर रही)/i;
const STARTISH = /(shuru|\bstart|शुरू)/i;

function fromNote(note) {
  const s = String(note || '');
  if (MERGED_RE.test(s)) return 'change_merged';
  if (TESTING_RE.test(s)) return 'testing';
  if (DONE_RE.test(s) && !STARTISH.test(s)) return 'done';
  if (PLANNING_RE.test(s)) return 'planning';
  if (CODING_RE.test(s)) return 'coding';
  return null;
}

module.exports = { STATUSES, ALL, RANK, LABEL, ALIAS, norm, isOpen, aggregate, fromNote, DONE_RE, CODING_RE, TESTING_RE };
