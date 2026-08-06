/**
 * PathCrumbInput — behavior tests.
 *
 * Behaviors covered:
 *  - Enter calls onNavigate with the current draft text.
 *  - Escape (when the draft differs from value) reverts the input to `value`
 *    and does NOT call onNavigate.
 *  - The input re-syncs to `value` when it changes from outside (rerender).
 *  - Escape wins the race against an ancestor's capture-phase Escape-close
 *    listener (Radix Dialog's own `useEscapeKeydown`) while the draft is
 *    dirty, and lets it through once there's nothing left to revert.
 */
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PathCrumbInput } from '../PathCrumbInput';

/**
 * Stands in for Radix Dialog's `DismissableLayer`: registers its own
 * document-level, capture-phase Escape listener — exactly how
 * `@radix-ui/react-use-escape-keydown` closes the dialog. Since it wraps
 * `children` (PathCrumbInput mounts as its descendant), React commits the
 * child's mount effects before the parent's — the same ordering the real
 * Dialog/PathCrumbInput pairing has in production.
 */
function DialogLikeWrapper({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }
    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [onDismiss]);
  return <>{children}</>;
}

describe('PathCrumbInput — Enter navigates', () => {
  it('calls onNavigate with the typed draft on Enter', async () => {
    const onNavigate = vi.fn();
    render(<PathCrumbInput value="~" onNavigate={onNavigate} />);

    const input = screen.getByTestId('directory-picker-path-input');
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/proj{Enter}');

    expect(onNavigate).toHaveBeenCalledWith('/Users/me/proj');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('PathCrumbInput — Escape reverts', () => {
  it('reverts the draft to value and does not call onNavigate', async () => {
    const onNavigate = vi.fn();
    render(<PathCrumbInput value="~" onNavigate={onNavigate} />);

    const input = screen.getByTestId('directory-picker-path-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/proj');
    expect(input.value).toBe('/Users/me/proj');

    await userEvent.keyboard('{Escape}');

    expect(input.value).toBe('~');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('PathCrumbInput — beats a Radix-style capture-phase Escape-close listener', () => {
  it('reverts the dirty draft in place and stops an ancestor capture-phase Escape listener from firing', async () => {
    const onDismiss = vi.fn();
    render(
      <DialogLikeWrapper onDismiss={onDismiss}>
        <PathCrumbInput value="~" onNavigate={vi.fn()} />
      </DialogLikeWrapper>,
    );

    const input = screen.getByTestId('directory-picker-path-input') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '/Users/me/proj');
    expect(input.value).toBe('/Users/me/proj');

    await userEvent.keyboard('{Escape}');

    // Reverted in place, and the dialog never heard about it.
    expect(input.value).toBe('~');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('lets the ancestor capture-phase Escape listener fire when the crumb is unedited', async () => {
    const onDismiss = vi.fn();
    render(
      <DialogLikeWrapper onDismiss={onDismiss}>
        <PathCrumbInput value="~" onNavigate={vi.fn()} />
      </DialogLikeWrapper>,
    );

    const input = screen.getByTestId('directory-picker-path-input');
    input.focus();

    await userEvent.keyboard('{Escape}');

    // Nothing to revert — the dialog's own Escape-close gets to run.
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('PathCrumbInput — re-sync on value change', () => {
  it('updates the input value when the `value` prop changes', () => {
    const { rerender } = render(<PathCrumbInput value="~" onNavigate={() => {}} />);

    const input = screen.getByTestId('directory-picker-path-input') as HTMLInputElement;
    expect(input.value).toBe('~');

    rerender(<PathCrumbInput value="/Users/me/other" onNavigate={() => {}} />);

    expect(input.value).toBe('/Users/me/other');
  });
});
