// Slash commands the server understands (docs/backend.md). The palette in the composer lists these.
export const COMMANDS: { cmd: string; args: string; desc: string; needsTask?: boolean }[] = [
  { cmd: '/task', args: '<name> <text> [due kal]', desc: 'Assign a task' },
  { cmd: '/update', args: '[#id] <note>', desc: 'Add a progress note', needsTask: true },
  { cmd: '/done', args: '[#id] [note]', desc: 'Mark a task done', needsTask: true },
  { cmd: '/testing', args: '[#id] [note]', desc: 'Move a task to Testing', needsTask: true },
  { cmd: '/reassign', args: '#id <name>', desc: 'Give a task to someone else', needsTask: true },
  { cmd: '/due', args: '#id <date>', desc: 'Change the due date', needsTask: true },
  { cmd: '/delete', args: '#id', desc: 'Delete a task', needsTask: true },
  { cmd: '/tasks', args: '[name]', desc: 'Show open tasks' },
  { cmd: '/mytasks', args: '', desc: 'Show my tasks' },
  { cmd: '/help', args: '', desc: 'List all commands' },
];
