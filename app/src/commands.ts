import { Ionicons } from '@expo/vector-icons';

// Slash commands the server understands (docs/backend.md). The palette, the "/" sheet and the chips use this list.
// needsTask: picking it shows my open tasks ("/cmd #"); needsPerson: picking it opens the people picker.
export type Command = {
  cmd: string; args: string; desc: string; icon: keyof typeof Ionicons.glyphMap; needsTask?: boolean; needsPerson?: boolean;
};
export const COMMANDS: Command[] = [
  { cmd: '/task', args: '@name [@name2] <text> [due kal]', desc: 'Task do (ek ya zyada log)', icon: 'add-circle-outline', needsPerson: true },
  { cmd: '/done', args: '[#id] [note]', desc: 'Mera task Done', icon: 'checkmark-circle-outline', needsTask: true },
  { cmd: '/re', args: '#id [@old] @new', desc: 'Task kisi aur ko do', icon: 'swap-horizontal-outline', needsTask: true },
  { cmd: '/tasks', args: '[name]', desc: 'Open tasks (sabke / ek insaan ke)', icon: 'list-outline' },
  { cmd: '/mytasks', args: '', desc: 'Mere open tasks', icon: 'person-outline' },
  { cmd: '/help', args: '', desc: 'Saare commands', icon: 'information-circle-outline' },
  // Round 4: disabled (server still parses them; hidden from the palette):
  // /update /planning /coding /testing /merged /ask /desc /assign /unassign /reassign (= /re alias) /due /close /reopen
];

// Chips shown when the empty input is focused.
export const QUICK = ['/task', '/done', '/re', '/mytasks'];

// Due-date chips after "/due #id ".
export const DUE_CHIPS = ['aaj', 'kal', 'parso', 'mon', 'fri', 'none'];
