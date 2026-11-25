/**
 * jsdom lays nothing out, so a gate under test is given a layout: a slot of at
 * most `cap` px that scrolls, the head, one block per allowed part, and answers
 * that stay pinned to the slot's bottom edge, with the "Show the rest" button above them.
 */
import { vi } from 'vitest';

export interface GateLayout {
  cap: number;
  head: number;
  /** Px per part id; a part the test leaves out is one line tall. */
  parts: Record<string, number>;
  answers: number;
  button: number;
}

const LINE = 20;

/** A layout every gate fits in, unless told otherwise. Restored by `vi.restoreAllMocks`. */
export function installGateLayout(overrides: Partial<GateLayout> = {}): GateLayout {
  const layout: GateLayout = { cap: 1000, head: 50, parts: {}, answers: 44, button: 40, ...overrides };
  const box = (top: number, height: number) => new DOMRect(0, top, 600, height);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const slot = this.closest('[data-chat-gate]');
    if (!slot) return box(0, 0);
    const parts = [...slot.querySelectorAll<HTMLElement>('[data-allowed-part]')];
    const heights = parts.map((part) => layout.parts[part.dataset.allowedPart!] ?? LINE);
    const answers = layout.answers + (slot.querySelector('[data-gate-show-rest]') ? layout.button : 0);
    const content = layout.head + heights.reduce((sum, height) => sum + height, 0);
    const slotHeight = Math.min(layout.cap, content + answers);
    const scrolled = Math.max(0, Math.min(slot.scrollTop, content + answers - slotHeight));
    if (this === slot) return box(0, slotHeight);
    if (this.hasAttribute('data-gate-answers')) return box(Math.min(content - scrolled, slotHeight - answers), answers);
    const index = parts.indexOf(this as HTMLElement);
    if (index < 0) return box(0, 0);
    const above = heights.slice(0, index).reduce((sum, height) => sum + height, layout.head);
    return box(above - scrolled, heights[index]!);
  });
  return layout;
}
