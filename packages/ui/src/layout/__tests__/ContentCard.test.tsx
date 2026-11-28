import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('brings the spinner in once the hold has lasted the delay, counted from the hold, not the cover', () => {
    beginBootRestore();
    // The shell mounts the card a while after the hold began (a busy first render).
    vi.advanceTimersByTime(150);
    renderCard();
    const spinner = screen.getByTestId('content-card-boot-spinner');
    expect(spinner).toHaveAttribute('data-boot-spinner');
    expect(spinner.style.getPropertyValue('--mf-boot-spinner-delay')).toBe(`${BOOT_SPINNER_DELAY_MS - 150}ms`);
  });

  it('shows the spinner at once on a cover that mounts after the delay has passed', () => {
    beginBootRestore();
    vi.advanceTimersByTime(BOOT_SPINNER_DELAY_MS + 200);
    renderCard();
    expect(screen.getByTestId('content-card-boot-spinner').style.getPropertyValue('--mf-boot-spinner-delay')).toBe(
      '0ms',
    );
  });

  it('keeps the spinner transparent until its delay in CSS, so no timer on a busy main thread decides it', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/app.css'), 'utf8');
    const rule = /\[data-boot-spinner\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/opacity:\s*0;/);
    expect(rule).toMatch(/animation:\s*mf-boot-spinner-in 0s linear var\(--mf-boot-spinner-delay, 400ms\) forwards;/);
    expect(css).toMatch(/@keyframes mf-boot-spinner-in\s*\{\s*to\s*\{\s*opacity:\s*1;/);
  });

  it('is a plain card, and takes no focus, when nothing is being restored', () => {
    renderCard();
    expect(screen.queryByTestId('content-card-boot-cover')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
