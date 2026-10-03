import { act, fireEvent } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { ThreadAssistantMessage } from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { fixtureMessage, fixtureTool } from './fixtures';
import { turnSource } from './turn-fixtures';

export function turnTool(
  id = 'tool',
  overrides: Parameters<typeof fixtureTool>[0] = {},
  patch: Partial<TranscriptPresentation> = {},
): ThreadAssistantMessage {
  const message = fixtureMessage([fixtureTool({ toolCallId: id, ...overrides })], id);
  const source = turnSource(id, 0, 0, patch);
  return {
    ...message,
    metadata: {
      ...message.metadata,
      custom: { mainframe: { partSources: { 0: [{ ...source, startUtf16: undefined, endUtf16: undefined }] } } },
    },
  };
}
export function selectText(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}
export function clearSelection() {
  document.getSelection()?.removeAllRanges();
  fireEvent(document, new Event('selectionchange'));
}
export async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
export function expectControlsResolve(toggle: HTMLElement) {
  const ids = toggle.getAttribute('aria-controls')!.split(' ');
  expect(ids.length).toBeGreaterThan(0);
  ids.forEach((id) => expect(document.getElementById(id)).not.toBeNull());
}
