import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginBootRestore, decideBootRestore, resetBootRestore } from '@/features/sessions/runtime/boot-restore';
import { BOOT_SPINNER_DELAY_MS, ContentCard } from '../ContentCard';

beforeEach(() => {
  vi.useFakeTimers();
  resetBootRestore();
});
afterEach(() => vi.useRealTimers());

function renderCard() {
  return render(
    <ContentCard>
      <textarea data-testid="composer" data-mf-composer-input />
    </ContentCard>,
  );
}

describe('ContentCard — boot restore hold', () => {
  it('covers the card with an opaque sheet while the last chat is restored, then lifts it', () => {
    beginBootRestore();
    renderCard();
    const card = screen.getByTestId('content-card');
    const cover = screen.getByTestId('content-card-boot-cover');
    expect(card).toHaveAttribute('data-boot-restoring');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(cover).toHaveClass('absolute', 'inset-0', 'bg-background');
    // Marked as an overlay so a native preview webview steps aside for it.
    expect(cover).toHaveAttribute('data-preview-overlay');
    // The content is not hidden from the browser: visibility:hidden drops autofocus in WebKit.
    expect(card.className).not.toContain('invisible');
    expect(screen.getByTestId('composer')).toBeInTheDocument();

    act(() => decideBootRestore(null));
    expect(screen.queryByTestId('content-card-boot-cover')).toBeNull();
    expect(card).not.toHaveAttribute('data-boot-restoring');
    expect(card).not.toHaveAttribute('aria-busy');
  });

  it('keeps an autofocused composer focused under the cover', () => {
    beginBootRestore();
    renderCard();
    screen.getByTestId('composer').focus();
    expect(document.activeElement).toBe(screen.getByTestId('composer'));
    act(() => decideBootRestore(null));
    expect(document.activeElement).toBe(screen.getByTestId('composer'));
  });

  it('focuses the conversation composer when the cover lifts and nothing has focus', () => {
    beginBootRestore();
    renderCard();
    expect(document.activeElement).toBe(document.body);
    act(() => decideBootRestore(null));
    expect(document.activeElement).toBe(screen.getByTestId('composer'));
  });

  it('leaves focus where it is when something else already has it', () => {
    beginBootRestore();
    const view = render(
      <>
        <button data-testid="other" />
        <ContentCard>
          <textarea data-mf-composer-input />
        </ContentCard>
      </>,
    );
    screen.getByTestId('other').focus();
    act(() => decideBootRestore(null));
    expect(document.activeElement).toBe(screen.getByTestId('other'));
    view.unmount();
  });

  it('shows a spinner on the cover only after the delay', () => {
    beginBootRestore();
    renderCard();
    act(() => void vi.advanceTimersByTime(BOOT_SPINNER_DELAY_MS - 1));
    expect(screen.queryByTestId('content-card-boot-spinner')).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByTestId('content-card-boot-spinner')).toBeInTheDocument();
  });

  it('is a plain card, and takes no focus, when nothing is being restored', () => {
    renderCard();
    expect(screen.queryByTestId('content-card-boot-cover')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
