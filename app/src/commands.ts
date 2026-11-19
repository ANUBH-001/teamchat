import { Ionicons } from '@expo/vector-icons';

// Slash commands the server understands (docs/backend.md). The palette, the "/" sheet and the chips use this list.
// needsTask: picking it shows my open tasks ("/cmd #"); needsPerson: picking it opens the people picker.
export type Command = {
  cmd: string; args: string; desc: string; icon: keyof typeof Ionicons.glyphMap; needsTask?: boolean; needsPerson?: boolean;
};
export const COMMANDS: Command[] = [
  { cmd: '/task', args: '@name [@name2] <text> [due kal]', desc: 'Task do (ek ya zyada log, ya khud ko)', icon: 'add-circle-outline', needsPerson: true },
  { cmd: '/update', args: '[#id] <note>', desc: 'Progress note likho', icon: 'create-outline', needsTask: true },
  { cmd: '/planning', args: '[#id] [note]', desc: 'Mera status: Planning', icon: 'bulb-outline', needsTask: true },
  { cmd: '/coding', args: '[#id] [note]', desc: 'Mera status: Coding', icon: 'code-slash-outline', needsTask: true },
  { cmd: '/testing', args: '[#id] [note]', desc: 'Mera status: Testing', icon: 'flask-outline', needsTask: true },
  { cmd: '/merged', args: '[#id] [note]', desc: 'Mera status: Change merged', icon: 'git-merge-outline', needsTask: true },
  { cmd: '/done', args: '[#id] [note]', desc: 'Mera part Done', icon: 'checkmark-circle-outline', needsTask: true },
  { cmd: '/ask', args: '#id', desc: 'Status poochho (assignees ko notification)', icon: 'help-circle-outline', needsTask: true },
  { cmd: '/desc', args: '#id <text>', desc: 'Description badlo', icon: 'document-text-outline', needsTask: true },
  { cmd: '/assign', args: '#id @name', desc: 'Task mein aur log jodo', icon: 'person-add-outline', needsTask: true },
  { cmd: '/unassign', args: '#id @name', desc: 'Task se kisi ko hatao', icon: 'person-remove-outline', needsTask: true },
  { cmd: '/reassign', args: '#id @name', desc: 'Task naye logon ko do', icon: 'swap-horizontal-outline', needsTask: true },
  { cmd: '/due', args: '#id <date>', desc: 'Due date badlo', icon: 'calendar-outline', needsTask: true },
  { cmd: '/close', args: '#id [reason]', desc: 'Task band karo (banane wala / admin)', icon: 'close-circle-outline', needsTask: true },
  { cmd: '/reopen', args: '#id', desc: 'Band task wapas kholo', icon: 'refresh-outline' },
  { cmd: '/tasks', args: '[name]', desc: 'Open tasks (sabke / ek insaan ke)', icon: 'list-outline' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks', icon: 'person-outline' },
  { cmd: '/help', args: '', desc: 'Saare commands', icon: 'information-circle-outline' },
];

// Chips shown when the empty input is focused.
export const QUICK = ['/task', '/update', '/done', '/mytasks'];

// Due-date chips after "/due #id ".
export const DUE_CHIPS = ['aaj', 'kal', 'parso', 'mon', 'fri', 'none'];
