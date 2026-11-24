import type { ThreadMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import type { ToolPart, TurnScope } from '../types';

export function tool(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool-call',
    toolCallId: 'call',
    toolName: 'Read',
    args: { file_path: 'src/file.ts' },
    argsText: '',
    status: { type: 'complete' },
    ...overrides,
  } as ToolPart;
}

let calls = 0;
/** A settled call; pass `result: undefined` for one that never came back. */
export function call(toolName: string, args: Record<string, unknown>, overrides: Partial<ToolPart> = {}): ToolPart {
  return tool({
    toolCallId: `${toolName}-${++calls}`,
    toolName,
    args: args as ToolPart['args'],
    result: 'ok',
    ...overrides,
  });
}
export const bash = (command: string, overrides: Partial<ToolPart> = {}) => call('Bash', { command }, overrides);

type Part = ThreadMessage['content'][number] | ToolPart | { type: 'text'; text: string };
export const text = (value: string): Part => ({ type: 'text', text: value });
export const thought = (value = 'Hmm'): Part => ({ type: 'reasoning', text: value }) as Part;

function message(role: string, id: string, content: readonly Part[], custom?: object, extra?: object): ThreadMessage {
  return {
    id,
    role,
    createdAt: new Date(1_700_000_000_000),
    content,
    status: { type: 'complete', reason: 'stop' },
    metadata: { custom: custom ? { mainframe: custom } : {} },
    attachments: [],
    ...extra,
  } as unknown as ThreadMessage;
}
export const user = (id: string, value = 'hi', custom?: object) => message('user', id, [text(value)], custom);
export const assistant = (id: string, content: readonly Part[], custom?: object, extra?: object) =>
  message('assistant', id, content, custom, extra);
export const system = (id: string, custom: object) => message('system', id, [], custom);

export const presented = (overrides: Partial<TranscriptPresentation> = {}): TranscriptPresentation => ({
  version: 1,
  provider: 'claude',
  turnId: 'turn',
  state: 'completed',
  finalEligible: false,
  ...overrides,
});
/** `partSources` giving every part of a message the same provider metadata. */
export function sources(count: number, presentation: TranscriptPresentation) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      index,
      [{ sourceMessageId: `${presentation.turnId}-source`, sourceBlockIndex: index, presentation }],
    ]),
  );
}

export const scope = (overrides: Partial<TurnScope> = {}): TurnScope => ({
  rootThreadId: 'root',
  ancestors: [],
  pendingToolIds: new Set(),
  ...overrides,
});
