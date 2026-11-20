import { Ionicons } from '@expo/vector-icons';

// Slash commands the server understands (docs/backend.md). The palette, the "/" sheet and the chips use this list.
// needsTask: picking it shows my open tasks ("/cmd #"); needsPerson: picking it opens the people picker.
export type Command = {
  cmd: string; args: string; desc: string; icon: keyof typeof Ionicons.glyphMap; needsTask?: boolean; needsPerson?: boolean;
};
export const COMMANDS: Command[] = [
  { cmd: '/task', args: '@name [@name2] <text>', desc: 'Give a task (one or more people; members can only assign to themselves unless the admin allows assigning)', icon: 'add-circle-outline', needsPerson: true },
  { cmd: '/done', args: '[#id] [note]', desc: 'Mera task Done', icon: 'checkmark-circle-outline', needsTask: true },
  { cmd: '/re', args: '#id [@old] @new', desc: 'Give a task to someone else', icon: 'swap-horizontal-outline', needsTask: true },
  { cmd: '/tasks', args: '[name]', desc: "Open tasks (everyone's / one person's)", icon: 'list-outline' },
  { cmd: '/mytasks', args: '', desc: 'My open tasks', icon: 'person-outline' },
  { cmd: '/help', args: '', desc: 'All commands', icon: 'information-circle-outline' },
  // Round 4: disabled (server still parses them; hidden from the palette):
  // /update /planning /coding /testing /merged /ask /desc /assign /unassign /reassign (= /re alias) /close /reopen
];

// Chips shown when the empty input is focused.
export const QUICK = ['/task', '/done', '/re', '/mytasks'];

