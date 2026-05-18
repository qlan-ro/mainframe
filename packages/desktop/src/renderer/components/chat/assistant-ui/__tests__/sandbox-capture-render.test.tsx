import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import { formatCaptures } from '../../../../lib/format-captures.js';

let currentMessage: DisplayMessage;

vi.mock('@assistant-ui/react', () => ({
  MessagePrimitive: { Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
  useMessage: (sel?: (m: unknown) => unknown) => {
    const threadMsg = {
      role: 'user',
      content: currentMessage.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text })),
      __original: [currentMessage],
    };
    return sel ? sel(threadMsg) : threadMsg;
  },
  getExternalStoreMessages: (m: { __original: DisplayMessage[] }) => m.__original,
}));

vi.mock('../../../../store/skills', () => ({
  useSkillsStore: (sel: (s: unknown) => unknown) => sel({ skills: [], commands: [] }),
}));

vi.mock('../MainframeRuntimeProvider', () => ({
  useMainframeRuntime: () => ({ openLightbox: vi.fn() }),
}));

import { UserMessage } from '../messages/UserMessage';

function userMsg(
  text: string,
  opts?: { images?: { mediaType: string; data: string }[]; attachments?: unknown[] },
): DisplayMessage {
  return {
    id: 'm1',
    chatId: 'c1',
    type: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    content: [
      { type: 'text', text },
      ...(opts?.images ?? []).map((i) => ({ type: 'image' as const, mediaType: i.mediaType, data: i.data })),
    ],
    ...(opts?.attachments ? { metadata: { attachments: opts.attachments } } : {}),
  } as DisplayMessage;
}

describe('sandbox capture sentinel rendering in a sent user message', () => {
  it('renders SandboxCaptureContext + rest, hides sentinel/markdown', () => {
    const { markdown } = formatCaptures([
      {
        id: 'a',
        type: 'element',
        imageDataUrl: 'data:image/png;base64,QUJD',
        selector: 'div.card > h2',
        annotation: 'tweak this',
      },
      { id: 'b', type: 'screenshot', imageDataUrl: 'data:image/png;base64,WFla' },
    ]);
    currentMessage = userMsg(markdown + '\n\nfix the header', {
      images: [
        { mediaType: 'image/png', data: 'QUJD' },
        { mediaType: 'image/png', data: 'WFla' },
      ],
      attachments: [
        { name: 'element1.png', kind: 'image' },
        { name: 'screenshot1.png', kind: 'image' },
      ],
    });

    render(<UserMessage />);

    expect(screen.getByTestId('sandbox-capture-context')).toBeTruthy();
    expect(screen.getAllByTestId('selector-crumb').map((s) => s.textContent)).toEqual(['div.card', 'h2']);
    expect(screen.getByText('tweak this')).toBeTruthy();

    const body = document.body.textContent ?? '';
    expect(body).not.toContain('__MF_SANDBOX_CAPTURE__');
    expect(body).not.toContain('> - `element1`');
    expect(screen.getByText(/fix the header/)).toBeTruthy();
  });

  it('renders a normal user message without the sentinel unchanged (regression)', () => {
    currentMessage = userMsg('just a normal message');
    render(<UserMessage />);
    expect(screen.queryByTestId('sandbox-capture-context')).toBeNull();
    expect(screen.getByText('just a normal message')).toBeTruthy();
  });
});
