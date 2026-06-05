/**
 * Shared fixture helper for ToolCallMessagePartProps.
 *
 * Use makeToolPart() in card tests to build a complete, type-correct
 * ToolCallMessagePartProps without repeating boilerplate in every file.
 */
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';

export function makeToolPart(overrides: Partial<ToolCallMessagePartProps> = {}): ToolCallMessagePartProps {
  return {
    type: 'tool-call',
    toolCallId: 'tc-1',
    toolName: 'Tool',
    args: {},
    argsText: '',
    result: undefined,
    isError: false,
    status: { type: 'complete' } satisfies ToolCallMessagePartStatus,
    addResult: () => {},
    resume: () => {},
    respondToApproval: () => {},
    ...overrides,
  };
}
