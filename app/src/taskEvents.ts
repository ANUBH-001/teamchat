import { formatDue } from './dates';
import { Status, STATUS_LABEL, TaskEvent } from './taskTypes';

const st = (v: string | null) => (v && v in STATUS_LABEL ? STATUS_LABEL[v as Status] : v || '');

// One-line text for a task_events row (timeline in the task detail and the Activity feed).
export function describeEvent(e: Pick<TaskEvent, 'event' | 'oldValue' | 'newValue'>, who: string) {
  switch (e.event) {
    case 'created': return who + ' created the task';
    case 'status': return who + ' moved ' + (e.oldValue ? 'from ' + st(e.oldValue) + ' ' : '') + 'to ' + st(e.newValue);
    case 'assignee': return who + ' reassigned the task';
    case 'title': return who + ' renamed the task';
    case 'due': return who + ' set due date ' + (e.newValue ? formatDue(e.newValue) : 'none');
    case 'note': return who + ' added a note';
    case 'praise': return who + ' praised the work';
    case 'deleted': return who + ' deleted the task';
    default: return who + ' ' + e.event;
  }
}

export const EVENT_ICON: Record<string, string> = {
  created: 'add-circle', status: 'swap-horizontal', assignee: 'person', title: 'create', due: 'calendar',
  note: 'chatbubble-ellipses', praise: 'heart', deleted: 'trash',
};

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
};
