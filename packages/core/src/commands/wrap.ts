import { randomUUID } from 'node:crypto';

export function wrapMainframeCommand(name: string, _content: string, args?: string): string {
  const id = `cmd_${randomUUID().slice(0, 8)}`;
  const template = args ?? '';
  return [
    `<mainframe-command name="${name}" id="${id}">`,
    template,
    '',
    'Wrap your entire response in:',
    `<mainframe-command-response id="${id}">`,
    'YOUR RESPONSE HERE',
    '</mainframe-command-response>',
    '</mainframe-command>',
  ].join('\n');
}
