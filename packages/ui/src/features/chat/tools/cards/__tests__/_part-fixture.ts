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

/**
 * Tool cards must not nest their own vertical scroll region inside the chat
 * thread viewport — the viewport is the single overflow owner. A nested
 * vertical scroller paints a second scrollbar beside the thread's (todo #198
 * "double scrollbar"). Returns every descendant that would own vertical scroll.
 * Horizontal-only scrollers (`overflow-x-auto`, for wide code lines) are allowed.
 */
export function nestedVerticalScrollers(root: HTMLElement): Element[] {
  return Array.from(
    root.querySelectorAll(
      '[class~="overflow-y-auto"],[class~="overflow-y-scroll"],[class~="overflow-auto"],[class~="overflow-scroll"]',
    ),
  );
}
