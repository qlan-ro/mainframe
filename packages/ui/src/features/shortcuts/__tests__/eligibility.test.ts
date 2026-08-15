// @vitest-environment jsdom
/**
 * Target eligibility — the two rules the dispatcher applies before firing a
 * matched chord: an `editorYielding` entry stands down inside the code
 * editor's own keymap (AC 5), and a chord that carries no modifier is
 * suppressed while a text field has focus so typed letters don't fire
 * shortcuts (D7's text-field rule, keyed on the RESOLVED chord, not the
 * descriptor's `mod` flag — see fact 20).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ShortcutDescriptor } from '../shortcut-types';
import { isEligibleTarget } from '../eligibility';

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

const NO_MOD = { code: 'KeyN', meta: false, ctrl: false, alt: false, shift: false };
const WITH_META = { code: 'KeyN', meta: true, ctrl: false, alt: false, shift: false };
const WITH_CTRL = { code: 'Tab', meta: false, ctrl: true, alt: false, shift: false };
const WITH_ALT = { code: 'Digit1', meta: false, ctrl: false, alt: true, shift: false };
const SHIFT_ONLY = { code: 'KeyN', meta: false, ctrl: false, alt: false, shift: true };

function entry(over: Partial<ShortcutDescriptor> = {}): ShortcutDescriptor {
  return { id: 'fixture.entry', chord: { code: 'KeyN', mod: true }, label: 'Fixture', group: 'App', ...over };
}

describe('editorYielding — AC 5', () => {
  it('is ineligible when the target is inside a .cm-editor', () => {
    host = document.createElement('div');
    host.className = 'cm-editor';
    const inner = document.createElement('span');
    host.appendChild(inner);
    document.body.appendChild(host);

    expect(isEligibleTarget(inner, entry({ editorYielding: true }), WITH_META)).toBe(false);
  });

  it('is eligible when the target is outside any .cm-editor', () => {
    host = document.createElement('div');
    const input = document.createElement('input');
    host.appendChild(input);
    document.body.appendChild(host);

    expect(isEligibleTarget(input, entry({ editorYielding: true }), WITH_META)).toBe(true);
  });

  it('a non-yielding entry stays eligible inside the .cm-editor (⌘N)', () => {
    host = document.createElement('div');
    host.className = 'cm-editor';
    document.body.appendChild(host);

    expect(isEligibleTarget(host, entry(), WITH_META)).toBe(true);
  });
});

describe('text-field rule — D7, evaluated on the resolved chord', () => {
  it('suppresses a bare (no-modifier) chord from an <input>', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    host = input;

    expect(isEligibleTarget(input, entry(), NO_MOD)).toBe(false);
  });

  it('suppresses a Shift-only chord from an <input> — a typed character, not a shortcut', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    host = input;

    expect(isEligibleTarget(input, entry(), SHIFT_ONLY)).toBe(false);
  });

  it('allows a ⌘-carrying chord from an <input> (AC 4)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    host = input;

    expect(isEligibleTarget(input, entry(), WITH_META)).toBe(true);
  });

  it('allows a ⌃-carrying chord from a <textarea>', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    host = textarea;

    expect(isEligibleTarget(textarea, entry(), WITH_CTRL)).toBe(true);
  });

  it('allows an Alt-carrying chord from a <textarea>', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    host = textarea;

    expect(isEligibleTarget(textarea, entry(), WITH_ALT)).toBe(true);
  });

  it('suppresses a bare chord from a [contenteditable] element', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    host = div;

    expect(isEligibleTarget(div, entry(), NO_MOD)).toBe(false);
  });

  it('allows a ⌘-carrying chord from a [contenteditable] element', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    host = div;

    expect(isEligibleTarget(div, entry(), WITH_META)).toBe(true);
  });

  it('allows a bare chord from a plain, non-text element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    host = div;

    expect(isEligibleTarget(div, entry(), NO_MOD)).toBe(true);
  });
});

describe('the terminal’s hidden textarea — fact 20', () => {
  it('allows the ⌃Tab / ⌘1 / ⌃⇧Tab family from the xterm helper textarea', () => {
    const container = document.createElement('div');
    container.className = 'xterm';
    const textarea = document.createElement('textarea');
    textarea.className = 'xterm-helper-textarea';
    container.appendChild(textarea);
    document.body.appendChild(container);
    host = container;

    expect(isEligibleTarget(textarea, entry(), WITH_CTRL)).toBe(true);
    expect(isEligibleTarget(textarea, entry(), WITH_ALT)).toBe(true);
  });

  it('still suppresses a bare chord from the terminal helper textarea', () => {
    const container = document.createElement('div');
    container.className = 'xterm';
    const textarea = document.createElement('textarea');
    textarea.className = 'xterm-helper-textarea';
    container.appendChild(textarea);
    document.body.appendChild(container);
    host = container;

    expect(isEligibleTarget(textarea, entry(), NO_MOD)).toBe(false);
  });
});

describe('non-Element targets', () => {
  it('a window-shaped EventTarget is always eligible', () => {
    expect(isEligibleTarget(new EventTarget(), entry(), NO_MOD)).toBe(true);
  });

  it('a null target is eligible', () => {
    expect(isEligibleTarget(null, entry({ editorYielding: true }), NO_MOD)).toBe(true);
  });
});
