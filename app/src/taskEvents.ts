import { labelOf, TaskEvent } from './taskTypes';

const st = (v: string | null) => (v ? labelOf(v) : '');

type Ev = Pick<TaskEvent, 'event' | 'oldValue' | 'newValue'> & { subjectName?: string | null };

// One-line text for a task_events row (timeline in the task detail and the Activity feed).
// Old rows may carry in_progress / review (labelOf maps them).
export function describeEvent(e: Ev, who: string) {
  switch (e.event) {
    case 'created': return who + ' created the task';
    case 'status':
      if (e.subjectName) return e.subjectName + ': ' + st(e.newValue);
      return who + ' moved ' + (e.oldValue ? 'from ' + st(e.oldValue) + ' ' : '') + 'to ' + st(e.newValue);
    case 'planning': case 'coding': case 'testing': case 'change_merged': case 'done':
      return (e.subjectName || who) + ': ' + labelOf(e.event);
    case 'assignee': return who + ' reassigned the task';
    case 'assignee_add': return who + ' added ' + (e.newValue || 'someone');
    case 'assignee_remove': return who + ' removed ' + (e.newValue || 'someone');
    case 'title': return who + ' renamed the task';
    case 'description': return who + ' changed the description';
    case 'project': return who + ' changed the project';
    case 'due': return who + ' changed the task'; // old rows from when due dates existed
    case 'note': return who + ' added a note';
    case 'note_edited': return who + ' edited a note';
    case 'note_deleted': return who + ' deleted a note';
    case 'ask': return who + ' asked for an update';
    case 'praise': return who + ' praised the work';
    case 'closed': return who + ' closed the task' + (e.newValue ? ': ' + e.newValue : '');
    case 'reopened': return who + ' reopened the task';
    case 'deleted': return who + ' deleted the task';
    default: return who + ' ' + e.event;
  }
}

export const EVENT_ICON: Record<string, string> = {
  created: 'add-circle', status: 'swap-horizontal', assignee: 'person', assignee_add: 'person-add', assignee_remove: 'person-remove',
  title: 'create', description: 'document-text', project: 'folder', due: 'calendar',
  note: 'chatbubble-ellipses', note_edited: 'pencil', note_deleted: 'trash-outline', ask: 'help-circle', praise: 'heart',
  closed: 'close-circle', reopened: 'refresh-circle', deleted: 'trash',
  planning: 'swap-horizontal', coding: 'swap-horizontal', testing: 'swap-horizontal', change_merged: 'swap-horizontal', done: 'checkmark-circle',
};

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
// "5m ago" / "just now" (never "now ago")
export const agoText = (iso: string) => { const a = ago(iso); return a === 'now' ? 'just now' : a + ' ago'; };
