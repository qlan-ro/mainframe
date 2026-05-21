import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { UserMessage } from '../messages/UserMessage.js';
import { SANDBOX_CAPTURE_SENTINEL } from '../../../../lib/format-captures.js';

vi.mock('@assistant-ui/react', () => ({
  useMessage: vi.fn(),
  getExternalStoreMessages: vi.fn(),
  makeAssistantToolUI: vi.fn(() => () => null),
  MessagePrimitive: {
    Root: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
}));

vi.mock('../MainframeRuntimeProvider', () => ({
  useMainframeRuntime: () => ({ openLightbox: () => {} }),
}));

vi.mock('../../../../store/skills', () => ({
  useSkillsStore: (sel: (s: { skills: never[]; commands: never[] }) => unknown) => sel({ skills: [], commands: [] }),
}));

import { useMessage, getExternalStoreMessages } from '@assistant-ui/react';

const buildMessage = (text: string, images: { mediaType: string; data: string }[]) => ({
  id: 'm1',
  role: 'user' as const,
  content: [
    { type: 'text' as const, text },
    ...images.map((img) => ({ type: 'image' as const, mediaType: img.mediaType, data: img.data })),
  ],
  metadata: {
    attachments: images.map((_, i) => ({
      name: `${i === 0 ? 'screenshot1' : 'element1'}.png`,
      kind: 'image' as const,
    })),
  },
});

describe('UserMessage sandbox capture rendering', () => {
  it('renders metadata sidecar INSIDE the bubble, image thumbs below; no label prefix in rows', () => {
    const sentinelText = `${SANDBOX_CAPTURE_SENTINEL}\n> **Preview captures**\n> - \`screenshot1\` — "first note"\n> - \`element1\` — selector \`main > button.go\``;
    const msg = buildMessage(sentinelText, [
      { mediaType: 'image/png', data: 'AAA' },
      { mediaType: 'image/png', data: 'BBB' },
    ]);
    vi.mocked(useMessage).mockReturnValue({ content: msg.content } as never);
    vi.mocked(getExternalStoreMessages).mockReturnValue([msg] as never);

    render(<UserMessage />);

    const bubbles = document.querySelectorAll('[class*="rounded-[12px_12px_4px_12px]"]');
    expect(bubbles).toHaveLength(1);

    const meta = screen.getByTestId('sandbox-capture-context');
    expect(bubbles[0]!.contains(meta)).toBe(true);

    const rows = meta.querySelectorAll('[data-testid="capture-meta-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('first note');
    expect(rows[0]!.textContent).not.toContain('screenshot1');
    expect(rows[1]!.querySelectorAll('[data-testid="selector-crumb"]').length).toBe(2);

    const thumbs = screen.getAllByTestId('message-image-thumb');
    expect(thumbs).toHaveLength(2);
    for (const t of thumbs) {
      expect(bubbles[0]!.contains(t)).toBe(false);
    }
    const names = screen.getAllByTestId('thumb-name').map((n) => n.textContent);
    expect(names).toEqual(['screenshot1', 'element1']);
  });

  it('renders both metadata sidecar and text body inside the same bubble', () => {
    const sentinelText = `${SANDBOX_CAPTURE_SENTINEL}\n> **Preview captures**\n> - \`element1\` — selector \`main > button.go\`\n\nhello body`;
    const msg = buildMessage(sentinelText, [{ mediaType: 'image/png', data: 'AAA' }]);
    vi.mocked(useMessage).mockReturnValue({ content: msg.content } as never);
    vi.mocked(getExternalStoreMessages).mockReturnValue([msg] as never);

    render(<UserMessage />);

    const bubbles = document.querySelectorAll('[class*="rounded-[12px_12px_4px_12px]"]');
    expect(bubbles).toHaveLength(1);
    const bubble = bubbles[0]!;
    const meta = screen.getByTestId('sandbox-capture-context');
    expect(bubble.contains(meta)).toBe(true);
    expect(bubble.textContent).toContain('hello body');
  });

  it('omits the bubble entirely when there is no body text and no selector/annotation metadata', () => {
    const sentinelText = `${SANDBOX_CAPTURE_SENTINEL}\n> **Preview captures**\n> - \`screenshot1\``;
    const msg = buildMessage(sentinelText, [{ mediaType: 'image/png', data: 'AAA' }]);
    vi.mocked(useMessage).mockReturnValue({ content: msg.content } as never);
    vi.mocked(getExternalStoreMessages).mockReturnValue([msg] as never);

    render(<UserMessage />);
    expect(document.querySelectorAll('[class*="rounded-[12px_12px_4px_12px]"]')).toHaveLength(0);
    expect(screen.queryByTestId('sandbox-capture-context')).toBeNull();
    expect(screen.getAllByTestId('message-image-thumb')).toHaveLength(1);
  });
});
