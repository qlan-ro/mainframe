/**
 * useSessionPanelState — light dismiss of the floated stack: Escape, or a
 * pointer outside both the panel root and any portalled surface.
 *
 * The overlay is opened the way the rail opens it: a togglePanel click on the
 * already-open session card while the gutter is short.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { installPanelHarness, renderPanelState, setWidth, type PanelHarness } from './panel-state-harness';

let h: PanelHarness;

beforeEach(() => {
  h = installPanelHarness();
});

afterEach(() => {
  document.body.innerHTML = '';
});

function openOverlay() {
  const rendered = renderPanelState();
  setWidth(1000);
  act(() => rendered.result.current.togglePanel('session'));
  return rendered;
}

function pointerDownOn(target: Element) {
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
}

function escapeOn(target: EventTarget, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init }));
  });
}

describe('useSessionPanelState — light dismiss', () => {
  it('closes on a pointerdown outside the panel', () => {
    const { result } = openOverlay();
    const outside = document.createElement('div');
    document.body.append(outside);
    pointerDownOn(outside);
    expect(result.current.mode).toBe('rail');
  });

  it('leaves the panel open when it closes — dismissal is not a collapse', () => {
    const { result } = openOverlay();
    const outside = document.createElement('div');
    document.body.append(outside);
    pointerDownOn(outside);
    expect(result.current.isPanelOpen('session')).toBe(true);
  });

  it('stays open for a pointerdown inside the panel', () => {
    const { result } = openOverlay();
    const inside = document.createElement('button');
    h.root.append(inside);
    pointerDownOn(inside);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a portalled menu', () => {
    const { result } = openOverlay();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    menu.append(item);
    document.body.append(menu);
    pointerDownOn(item);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a Radix popper wrapper', () => {
    const { result } = openOverlay();
    const popper = document.createElement('div');
    popper.setAttribute('data-radix-popper-content-wrapper', '');
    document.body.append(popper);
    pointerDownOn(popper);
    expect(result.current.mode).toBe('overlay');
  });

  it('stays open for a pointerdown inside a portalled dialog', () => {
    const { result } = openOverlay();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    pointerDownOn(dialog);
    expect(result.current.mode).toBe('overlay');
  });

  it('closes on Escape', () => {
    const { result } = openOverlay();
    escapeOn(document);
    expect(result.current.mode).toBe('rail');
  });

  it('ignores an Escape another handler already consumed', () => {
    const { result } = openOverlay();
    const consumer = (e: Event) => e.preventDefault();
    // Capture-phase on document, dispatched from a descendant, so the consumer
    // provably runs before the hook's bubble-phase listener.
    document.addEventListener('keydown', consumer, true);
    escapeOn(h.root);
    document.removeEventListener('keydown', consumer, true);
    expect(result.current.mode).toBe('overlay');
  });

  it('ignores Escape while a Radix dialog is open, so the dialog keeps its own key', () => {
    const { result } = openOverlay();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(dialog);
    escapeOn(document);
    expect(result.current.mode).toBe('overlay');
  });

  it('ignores keys other than Escape', () => {
    const { result } = openOverlay();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(result.current.mode).toBe('overlay');
  });

  it('does not listen while the stack is inline', () => {
    const { result } = renderPanelState();
    setWidth(1600);
    const outside = document.createElement('div');
    document.body.append(outside);
    pointerDownOn(outside);
    escapeOn(document);
    expect(result.current.mode).toBe('inline');
  });
});
