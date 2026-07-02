/**
 * ComposerAddAttachment / ComposerAddMention — bottom-toolbar left-slot icon buttons.
 *
 * Design (03-content.jsx:753-758): two separate 22×22 gActionStyle icon buttons —
 * paperclip AND at-sign — side by side, before the divider and config chips.
 * Parity finding 8.1/8.6 (2026-07-02-design-parity-drift-audit.md §8).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

const setTextSpy = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  AttachmentPrimitive: { Root: () => null },
  ComposerPrimitive: {
    AddAttachment: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  MessagePrimitive: { Attachments: () => null },
  useAuiState: () => undefined,
  useAui: () => ({
    composer: () => ({
      getState: () => ({ text: '' }),
      setText: setTextSpy,
    }),
    attachment: { source: 'composer' },
  }),
}));

import { ComposerAddAttachment, ComposerAddMention } from '../attachment';

function renderWithTooltip(children: React.ReactNode) {
  return render(<TooltipProvider>{children}</TooltipProvider>);
}

describe('ComposerAddAttachment — paperclip glyph size', () => {
  it('renders the Paperclip icon at size-3 (matches the design 12px glyph inside the 22px button)', () => {
    renderWithTooltip(<ComposerAddAttachment />);
    const btn = screen.getByTestId('composer-add-attachment');
    const svg = btn.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('size-3');
  });
});

describe('ComposerAddMention — dedicated @ toolbar button', () => {
  it('renders a 22px button with data-testid composer-add-mention', () => {
    renderWithTooltip(<ComposerAddMention />);
    const btn = screen.getByTestId('composer-add-mention');
    expect(btn.className).toContain('size-[22px]');
  });

  it('clicking it appends "@" to the composer text via setText', async () => {
    renderWithTooltip(<ComposerAddMention />);
    await userEvent.click(screen.getByTestId('composer-add-mention'));
    expect(setTextSpy).toHaveBeenCalledWith('@');
  });
});
