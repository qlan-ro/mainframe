/**
 * Toaster (sonner wrapper) regression test.
 *
 * Context: sonner's default collapsed stack clamps every toast to the front
 * toast's height and re-lays the stack out on hover. Our WsToastCards vary a
 * lot in height (a "Read more"-expanded error toast is ~306px), so without
 * `expand` a hovered stacked toast moved 314px — out from under the pointer,
 * which un-hovered it, which moved it back: a ~10Hz flicker loop. With
 * `expand`, hover-induced movement measures 0px.
 *
 * jsdom has no layout engine, so we can't reproduce the pixel movement here.
 * Instead we assert the contract that prevents it: `Toaster` must pass
 * `expand` (plus the other stack-geometry props) to sonner's `Toaster`. If
 * `expand` is ever dropped while tidying props, this test fails even though
 * nothing else would catch it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const sonnerToasterMock = vi.fn((_props: Record<string, unknown>) => null);

vi.mock('sonner', () => ({
  Toaster: (props: Record<string, unknown>) => sonnerToasterMock(props),
}));

import { Toaster } from '../sonner';

describe('Toaster', () => {
  it('passes expand and the stack geometry props to sonner', () => {
    render(<Toaster />);

    expect(sonnerToasterMock).toHaveBeenCalledWith({
      position: 'bottom-right',
      offset: 18,
      gap: 9,
      visibleToasts: 5,
      expand: true,
    });
  });
});
