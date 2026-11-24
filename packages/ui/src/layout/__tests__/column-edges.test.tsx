/**
 * column-edges — a column reports its left edge whenever it can have moved:
 * when it resizes, when the row it sits in does (a clamped column moves without
 * resizing), and when the window does.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useColumnEdge, useColumnEdges } from '../column-edges';

const observed: { el: Element; notify: () => void }[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(el: Element) {
    observed.push({ el, notify: this.callback });
  }
  unobserve() {}
  disconnect() {
    for (let i = observed.length - 1; i >= 0; i--) if (observed[i]!.notify === this.callback) observed.splice(i, 1);
  }
}

let left: number;

function Columns() {
  return (
    <div data-testid="row">
      <div ref={useColumnEdge('workspace')} data-testid="column" />
    </div>
  );
}

beforeEach(() => {
  left = 600;
  observed.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(left, 0, 320, 800));
  useColumnEdges.setState({ workspace: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const edge = () => useColumnEdges.getState().workspace;
const resize = (el: Element) => act(() => observed.filter((o) => o.el === el).forEach((o) => o.notify()));

describe('useColumnEdge', () => {
  it('reports the edge on mount and drops it on unmount', () => {
    const { unmount } = render(<Columns />);
    expect(edge()).toBe(600);
    unmount();
    expect(edge()).toBeNull();
    expect(observed).toEqual([]);
  });

  it('follows the column when it resizes', () => {
    const { getByTestId } = render(<Columns />);
    left = 560;
    resize(getByTestId('column'));
    expect(edge()).toBe(560);
  });

  it('follows a clamped column that its row moves without resizing', () => {
    const { getByTestId } = render(<Columns />);
    left = 480;
    resize(getByTestId('row'));
    expect(edge()).toBe(480);
  });

  it('follows a window resize', () => {
    render(<Columns />);
    left = 440;
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(edge()).toBe(440);
  });
});
