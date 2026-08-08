/**
 * ComposerAddAttachment / ComposerAddMention — bottom-toolbar left-slot icon buttons.
 *
 * Two separate icon buttons — paperclip AND at-sign — side by side, before the
 * separator and the config chips. On v2 they are `Button size="icon-xs"`: the
 * app's 24px/12px icon-button step (WorkspaceStripActions, MessageActionBar),
 * replacing the hand-rolled 22px `TooltipIconButton`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

const setTextSpy = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  AttachmentPrimitive: { Root: () => null, Remove: () => null },
  ComposerPrimitive: {
    AddAttachment: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
    Attachments: () => null,
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

import { ComposerAddAttachment, ComposerAddMention } from '../ComposerAttachmentStrip';

// The v2 Hint has no provider of its own (shadcn treats that as an app-root
// concern — SidebarProvider mounts it), so a bare render must supply one.
function renderWithTooltip(children: React.ReactNode) {
  return render(<TooltipProvider>{children}</TooltipProvider>);
}

describe('ComposerAddAttachment — the app icon-button step', () => {
  it('renders the paperclip button at the icon-xs step (24px box, 12px glyph)', () => {
    renderWithTooltip(<ComposerAddAttachment />);
    const btn = screen.getByTestId('composer-add-attachment');
    expect(btn).toHaveAttribute('data-size', 'icon-xs');
    expect(btn.className).toContain('size-6');
  });

  it('leaves the glyph unsized so the button owns it', () => {
    renderWithTooltip(<ComposerAddAttachment />);
    const svg = screen.getByTestId('composer-add-attachment').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class') ?? '').not.toContain('size-');
  });
});

describe('ComposerAddMention — dedicated @ toolbar button', () => {
  it('renders an icon-xs button with data-testid composer-add-mention', () => {
    renderWithTooltip(<ComposerAddMention />);
    const btn = screen.getByTestId('composer-add-mention');
    expect(btn).toHaveAttribute('data-size', 'icon-xs');
    expect(btn.className).toContain('size-6');
  });

  it('clicking it appends "@" to the composer text via setText', async () => {
    renderWithTooltip(<ComposerAddMention />);
    await userEvent.click(screen.getByTestId('composer-add-mention'));
    expect(setTextSpy).toHaveBeenCalledWith('@');
  });

  it('prevents default on mousedown so the composer textarea never loses focus', () => {
    renderWithTooltip(<ComposerAddMention />);
    const btn = screen.getByTestId('composer-add-mention');
    const event = fireEvent.mouseDown(btn);
    // fireEvent returns false when preventDefault() was called on the dispatched event
    expect(event).toBe(false);
  });
});

describe('ComposerAddAttachment — focus guard', () => {
  it('prevents default on mousedown so the composer textarea never loses focus', () => {
    renderWithTooltip(<ComposerAddAttachment />);
    const btn = screen.getByTestId('composer-add-attachment');
    const event = fireEvent.mouseDown(btn);
    expect(event).toBe(false);
  });
});
