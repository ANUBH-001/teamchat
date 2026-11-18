import { Ionicons } from '@expo/vector-icons';

// Slash commands the server understands (docs/backend.md). The palette, the "/" sheet and the chips use this list.
// needsTask: picking it shows my open tasks ("/cmd #"); needsPerson: picking it opens the people picker.
export type Command = {
  cmd: string; args: string; desc: string; icon: keyof typeof Ionicons.glyphMap; needsTask?: boolean; needsPerson?: boolean;
};
export const COMMANDS: Command[] = [
  { cmd: '/task', args: '<name> <text> [due kal]', desc: 'Kisi ko task do', icon: 'add-circle-outline', needsPerson: true },
  { cmd: '/update', args: '[#id] <note>', desc: 'Progress note likho', icon: 'create-outline', needsTask: true },
  { cmd: '/done', args: '[#id] [note]', desc: 'Task complete', icon: 'checkmark-circle-outline', needsTask: true },
  { cmd: '/testing', args: '[#id] [note]', desc: 'Task Testing mein', icon: 'flask-outline', needsTask: true },
  { cmd: '/ask', args: '#id', desc: 'Status poochho (assignee ko notification)', icon: 'help-circle-outline', needsTask: true },
  { cmd: '/desc', args: '#id <text>', desc: 'Description badlo', icon: 'document-text-outline', needsTask: true },
  { cmd: '/reassign', args: '#id <name>', desc: 'Task kisi aur ko do', icon: 'swap-horizontal-outline', needsTask: true },
  { cmd: '/due', args: '#id <date>', desc: 'Due date badlo', icon: 'calendar-outline', needsTask: true },
  { cmd: '/delete', args: '#id', desc: 'Task delete', icon: 'trash-outline', needsTask: true },
  { cmd: '/tasks', args: '[name]', desc: 'Open tasks (sabke / ek insaan ke)', icon: 'list-outline' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks', icon: 'person-outline' },
  { cmd: '/help', args: '', desc: 'Saare commands', icon: 'information-circle-outline' },
];

// Chips shown when the empty input is focused.
export const QUICK = ['/task', '/update', '/done', '/mytasks'];

// Due-date chips after "/due #id ".
export const DUE_CHIPS = ['aaj', 'kal', 'parso', 'mon', 'fri', 'none'];
