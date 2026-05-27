import { describe, expect, it, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { ScrollRow } from '../scroll-row';

function setGeometry(
  el: HTMLElement,
  { scrollWidth, clientWidth, scrollLeft }: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
}

describe('<ScrollRow>', () => {
  it('renders children', () => {
    const { getByText } = render(
      <ScrollRow>
        <span>chip-a</span>
        <span>chip-b</span>
      </ScrollRow>,
    );
    expect(getByText('chip-a')).toBeTruthy();
    expect(getByText('chip-b')).toBeTruthy();
  });

  it('sets dir="ltr" on the scroll container', () => {
    const { getByTestId } = render(
      <ScrollRow data-testid="row">
        <span>x</span>
      </ScrollRow>,
    );
    expect(getByTestId('row').getAttribute('dir')).toBe('ltr');
  });

  it('shows right fade when content overflows and hides it at scroll end', () => {
    const { getByTestId, container } = render(
      <ScrollRow data-testid="row">
        <span>x</span>
      </ScrollRow>,
    );
    const scroller = getByTestId('row');
    setGeometry(scroller, { scrollWidth: 1000, clientWidth: 200, scrollLeft: 0 });

    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(container.querySelector('[data-scroll-fade="right"]')).toBeTruthy();
    expect(container.querySelector('[data-scroll-fade="left"]')).toBeNull();

    setGeometry(scroller, { scrollWidth: 1000, clientWidth: 200, scrollLeft: 800 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(container.querySelector('[data-scroll-fade="right"]')).toBeNull();
    expect(container.querySelector('[data-scroll-fade="left"]')).toBeTruthy();
  });

  it('shows no fade when content fits', () => {
    const { getByTestId, container } = render(
      <ScrollRow data-testid="row">
        <span>x</span>
      </ScrollRow>,
    );
    const scroller = getByTestId('row');
    setGeometry(scroller, { scrollWidth: 100, clientWidth: 200, scrollLeft: 0 });
    act(() => {
      fireEvent.scroll(scroller);
    });
    expect(container.querySelector('[data-scroll-fade]')).toBeNull();
  });

  it('marks fade masks aria-hidden and pointer-events-none', () => {
    const { getByTestId, container } = render(
      <ScrollRow data-testid="row">
        <span>x</span>
      </ScrollRow>,
    );
    const scroller = getByTestId('row');
    setGeometry(scroller, { scrollWidth: 1000, clientWidth: 200, scrollLeft: 0 });
    act(() => fireEvent.scroll(scroller));

    const fade = container.querySelector('[data-scroll-fade="right"]') as HTMLElement;
    expect(fade.getAttribute('aria-hidden')).toBe('true');
    expect(fade.className).toMatch(/\bpointer-events-none\b/);
  });

  it('calls scrollIntoView when an offscreen child receives focus', () => {
    const scrollIntoView = vi.fn();
    const { getByTestId } = render(
      <ScrollRow data-testid="row">
        <button data-testid="btn">x</button>
      </ScrollRow>,
    );
    const btn = getByTestId('btn');
    btn.scrollIntoView = scrollIntoView;
    act(() => {
      btn.focus();
    });
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
  });

  it('forwards data-testid', () => {
    const { getByTestId } = render(
      <ScrollRow data-testid="my-row">
        <span>x</span>
      </ScrollRow>,
    );
    expect(getByTestId('my-row')).toBeTruthy();
  });

  // Structural proxy for the spec's focus-ring-visibility requirement.
  // jsdom does not compute geometry, so we can't measure a focus outline's
  // bounding rect directly; the visual assertion is in the manual acceptance
  // walkthrough. This test verifies the mechanism the spec defines: the
  // scroll container reserves vertical breathing room via `py-0.5`.
  it('reserves vertical breathing room (py-0.5) on the scroll container', () => {
    const { getByTestId } = render(
      <ScrollRow data-testid="row">
        <span>x</span>
      </ScrollRow>,
    );
    expect(getByTestId('row').className).toMatch(/\bpy-0\.5\b/);
  });
});
