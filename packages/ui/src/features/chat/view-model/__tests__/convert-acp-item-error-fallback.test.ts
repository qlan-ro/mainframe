/**
 * convertAcpItems — error-container fallback text
 * not covered by convert-acp-item.test.ts's single happy-path scenarios.
 * Split into its own file to keep convert-acp-item.test.ts under the 300-line
 * cap (it was already at 589 before this file existed).
 */
import { describe, expect, it } from 'vitest';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { MainframeMessageMeta } from '../message-meta';
import type { ThreadMessageLike } from '@assistant-ui/react';

const stampFor = () => new Date('2026-08-28T00:00:00.000Z');

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

function mainframeMeta(container: ThreadMessageLike): MainframeMessageMeta | undefined {
  return (container.metadata?.custom as { mainframe?: MainframeMessageMeta } | undefined)?.mainframe;
}

describe('convertAcpItems — error container: errorText fallback chain', () => {
  it('falls back to the block content text when errorText meta is absent', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'e1',
        role: 'agent',
        content: [textBlock('the CLI process crashed')],
        meta: itemMeta({ kind: 'error' }),
      },
    ];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.errorText).toBe('the CLI process crashed');
    expect(container.content).toEqual([{ type: 'text', text: 'the CLI process crashed' }]);
  });

  it('falls back to "An error occurred" when errorText is absent and the block content is empty', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'e2', role: 'agent', content: [], meta: itemMeta({ kind: 'error' }) },
    ];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.errorText).toBe('An error occurred');
  });

  it('falls back to "An error occurred" when the block content is whitespace-only', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'e3', role: 'agent', content: [textBlock('   ')], meta: itemMeta({ kind: 'error' }) },
    ];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.errorText).toBe('An error occurred');
  });

  it('prefers an explicit errorText meta over the block content', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'e4',
        role: 'agent',
        content: [textBlock('raw text nobody should read')],
        meta: itemMeta({ kind: 'error', errorText: 'CLI died' }),
      },
    ];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.errorText).toBe('CLI died');
  });
});
