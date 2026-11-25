/**
 * ComposerAddMenu — the composer's `+` (C4): attach files, or mention a file or
 * agent. The aui file dialog is stubbed to a spy on its trigger's click.
 */
import { cloneElement, useRef, type ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';

let mockComposerText = '';
const setTextSpy = vi.fn();
const openFileDialog = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    // asChild: the real primitive clones its child with the dialog-opening click.
    AddAttachment: ({ children }: { children: ReactElement<{ onClick?: () => void }> }) =>
      cloneElement(children, { onClick: openFileDialog }),
  },
  useAui: () => ({
    composer: {
      setText: setTextSpy,
      __internal_getRuntime: () => ({ getState: () => ({ text: mockComposerText }) }),
    },
  }),
}));

import { ComposerAddMenu } from '../ComposerAddMenu';

function Host({ initialText }: { initialText: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <TooltipProvider>
      <form onSubmit={(e) => e.preventDefault()}>
        <textarea ref={textareaRef} defaultValue={initialText} data-testid="host-textarea" />
        <ComposerAddMenu textareaRef={textareaRef} />
      </form>
    </TooltipProvider>
  );
}

async function openMenu() {
  fireEvent.pointerDown(screen.getByTestId('composer-add-menu'), { button: 0 });
  await screen.findByTestId('composer-add-attachment');
}

beforeEach(() => {
  mockComposerText = '';
  setTextSpy.mockClear();
  openFileDialog.mockClear();
});

describe('ComposerAddMenu', () => {
  it('is a labelled type="button" trigger, so it never submits the composer form', () => {
    render(<Host initialText="" />);

    const trigger = screen.getByTestId('composer-add-menu');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-label', 'Attach or mention');
  });

  it('offers "Attach files" and "Mention a file or agent…"', async () => {
    render(<Host initialText="" />);

    await openMenu();

    expect(screen.getByTestId('composer-add-attachment')).toHaveTextContent('Attach files…');
    expect(screen.getByTestId('composer-add-mention')).toHaveTextContent('Mention a file or agent…');
  });

  it('opens the file dialog after the menu closes when "Attach files" is picked', async () => {
    render(<Host initialText="" />);
    await openMenu();

    fireEvent.click(screen.getByTestId('composer-add-attachment'));

    await waitFor(() => expect(openFileDialog).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['an empty draft gets a bare @', '', '@'],
    ['a draft with no trailing whitespace gets a leading space', 'hello', 'hello @'],
    ['a draft already ending in a space gets none added', 'hello ', 'hello @'],
    ['a draft ending in a newline gets none added', 'hello\n', 'hello\n@'],
  ])('mention: %s', async (_label, initial, expected) => {
    mockComposerText = initial;
    render(<Host initialText={initial} />);
    await openMenu();

    fireEvent.click(screen.getByTestId('composer-add-mention'));

    await waitFor(() => expect(screen.getByTestId('host-textarea')).toHaveValue(expected));
  });
});
