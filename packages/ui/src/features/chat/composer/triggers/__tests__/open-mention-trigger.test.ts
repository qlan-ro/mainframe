// @vitest-environment jsdom
/**
 * open-mention-trigger — the draft rule and the DOM write behind the composer's
 * add-mention button (todo #316). The four draft cases mirror the click-path
 * table in ComposerAttachmentStrip.test.tsx so the two can't drift.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mentionDraft, writeComposerDraft } from '../open-mention-trigger';

describe('mentionDraft', () => {
  it.each([
    ['empty draft gets a bare @', '', '@'],
    ['draft with no trailing whitespace gets a leading space', 'hello', 'hello @'],
    ['draft already ending in a space gets none added', 'hello ', 'hello @'],
    ['draft ending in a newline gets none added', 'hello\n', 'hello\n@'],
  ])('%s', (_label, text, expected) => {
    expect(mentionDraft(text)).toBe(expected);
  });
});

describe('writeComposerDraft', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(initial: string) {
    const host = document.createElement('div');
    const el = document.createElement('textarea');
    el.value = initial;
    host.appendChild(el);
    document.body.appendChild(host);
    return { host, el };
  }

  it('focuses the textarea, writes the draft, and puts the caret at the end', () => {
    const { el } = mount('hello');

    writeComposerDraft(el, 'hello @');

    expect(el.value).toBe('hello @');
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(7);
    expect(el.selectionEnd).toBe(7);
  });

  it('dispatches a bubbling input event so React and the trigger engine see the change', () => {
    const { host, el } = mount('');
    const onInput = vi.fn();
    host.addEventListener('input', onInput);

    writeComposerDraft(el, '@');

    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('sets the caret before dispatching, so the handler reads the new position', () => {
    const { el } = mount('');
    const caretAtDispatch: Array<number | null> = [];
    el.addEventListener('input', () => caretAtDispatch.push(el.selectionStart));

    writeComposerDraft(el, '@');

    expect(caretAtDispatch).toEqual([1]);
  });

  it('bypasses the own value accessor React installs, so the tracker still sees a change', () => {
    const { el } = mount('');
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
    const ownWrites = vi.fn();
    // React's value tracker is exactly this: an own accessor shadowing the prototype's.
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: () => proto.get!.call(el),
      set: (v: string) => {
        ownWrites(v);
        proto.set!.call(el, v);
      },
    });

    writeComposerDraft(el, '@');

    expect(ownWrites).not.toHaveBeenCalled();
    expect(proto.get!.call(el)).toBe('@');
  });
});
