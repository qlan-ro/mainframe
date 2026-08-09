/**
 * ComposerAddAttachment / ComposerAddMention — bottom-toolbar left-slot icon buttons.
 *
 * Two separate icon buttons — paperclip AND at-sign — side by side, before the
 * separator and the config chips. On v2 they are `Button size="icon-xs"`: the
 * app's 24px/12px icon-button step (WorkspaceStripActions, MessageActionBar),
 * replacing the hand-rolled 22px `TooltipIconButton`.
 */
import { useRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';

let mockComposerText = '';
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
      getState: () => ({ text: mockComposerText }),
      setText: setTextSpy,
      // Live-state seam (todo #316): the handler must read through this, not
      // the tap-memoized `getState()`, so a click right after another
      // programmatic write sees the current draft.
      __internal_getRuntime: () => ({ getState: () => ({ text: mockComposerText }) }),
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

/**
 * `ComposerPrimitive.Root` renders a real `<form>` (todo #316's root cause):
 * a button with no explicit `type` defaults to `submit` inside it. This
 * mirrors that shape so a regression can't hide behind a bare, form-less render.
 */
function renderInForm(children: React.ReactNode, submitSpy: (e: React.FormEvent) => void) {
  return render(
    <TooltipProvider>
      <form onSubmit={submitSpy}>{children}</form>
    </TooltipProvider>,
  );
}

function makeSubmitSpy() {
  return vi.fn((e: React.FormEvent) => e.preventDefault());
}

/** Mounts a real, uncontrolled textarea beside the button — the DOM node the click handler must write to. */
function MentionButtonWithTextarea({ initialText }: { initialText: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <textarea ref={textareaRef} defaultValue={initialText} data-testid="host-textarea" />
      {/* @ts-expect-error todo #316 task 6 adds textareaRef to ComposerAddMention's props */}
      <ComposerAddMention textareaRef={textareaRef} />
    </>
  );
}

beforeEach(() => {
  mockComposerText = '';
  setTextSpy.mockClear();
});

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

describe('ComposerAddMention / ComposerAddAttachment — explicit button type (todo #316)', () => {
  it('composer-add-mention carries type="button"', () => {
    renderWithTooltip(<ComposerAddMention />);
    expect(screen.getByTestId('composer-add-mention')).toHaveAttribute('type', 'button');
  });

  it('composer-add-attachment carries type="button" (inherited from the Button primitive default)', () => {
    renderWithTooltip(<ComposerAddAttachment />);
    expect(screen.getByTestId('composer-add-attachment')).toHaveAttribute('type', 'button');
  });
});

describe('ComposerAddMention — must never submit the composer form (todo #316)', () => {
  it.each([
    ['an empty draft', ''],
    ['a non-empty draft', 'hello'],
  ])('clicking it with %s does not submit the form', async (_label, text) => {
    mockComposerText = text;
    const submitSpy = makeSubmitSpy();
    renderInForm(<MentionButtonWithTextarea initialText={text} />, submitSpy);

    await userEvent.click(screen.getByTestId('composer-add-mention'));

    expect(submitSpy).not.toHaveBeenCalled();
  });
});

describe('ComposerAddMention — draft write matches the typed-"@" rule (todo #316)', () => {
  it.each([
    ['empty draft gets a bare @', '', '@'],
    ['draft with no trailing whitespace gets a leading space', 'hello', 'hello @'],
    ['draft already ending in a space gets none added', 'hello ', 'hello @'],
    ['draft ending in a newline gets none added', 'hello\n', 'hello\n@'],
  ])('%s', async (_label, initial, expected) => {
    mockComposerText = initial;
    const submitSpy = makeSubmitSpy();
    renderInForm(<MentionButtonWithTextarea initialText={initial} />, submitSpy);

    await userEvent.click(screen.getByTestId('composer-add-mention'));

    expect(screen.getByTestId('host-textarea')).toHaveValue(expected);
  });
});
