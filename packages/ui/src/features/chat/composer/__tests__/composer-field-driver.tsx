/**
 * Drives the composer's text field the same way in both modes: the textarea
 * (setting off) and the Lexical chip field (setting on). A suite written
 * against these helpers runs unchanged with `describe.each(FIELD_MODES)`.
 *
 * Typing in the chip field goes through the editor, one character per update,
 * the way input events arrive; react-lexical's SyncPlugin then writes the
 * composer text and its CursorPlugin moves the trigger engine's caret, as in
 * the app. Keys are real keydown events on the field in both modes.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessage } from '@assistant-ui/react';
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { useUiPrefs } from '@/store/ui-prefs';

export type FieldMode = 'textarea' | 'chips';
export const FIELD_MODES: readonly FieldMode[] = ['textarea', 'chips'];

export function setFieldMode(mode: FieldMode): void {
  useUiPrefs.setState({ chipComposer: mode === 'chips' });
}

/**
 * The live field. Async: the chip field is a lazy chunk, and its first import
 * in a busy test run can take longer than Testing Library's 1 s default.
 */
export function findField(testId = 'chat-composer-input'): Promise<HTMLElement> {
  return screen.findByTestId(testId, undefined, { timeout: 5000 });
}

function editorOf(field: HTMLElement): LexicalEditor | null {
  return (field as HTMLElement & { __lexicalEditor?: LexicalEditor }).__lexicalEditor ?? null;
}

/** A bare runtime for a field rendered outside `Composer` (edit mode, segments): the chip editor reads the thread. */
export function RuntimeShell({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({ isRunning: false, messages: [], onNew: async () => {} });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

/** Replaces everything in the field, as one edit. */
export function replaceText(field: HTMLElement, text: string): void {
  const editor = editorOf(field);
  if (!editor) {
    fireEvent.change(field, { target: { value: text } });
    return;
  }
  act(() => {
    editor.update(
      () => {
        $getRoot().clear().append($createParagraphNode()).selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(text);
      },
      { discrete: true },
    );
  });
}

export function isReadOnly(field: HTMLElement): boolean {
  return field.hasAttribute('readonly') || field.getAttribute('contenteditable') === 'false';
}

/** Types `text` at the caret; a `\n` is a new line (⇧↵). */
export function typeInto(field: HTMLElement, text: string): void {
  const editor = editorOf(field);
  if (!editor) {
    const value = (field as HTMLTextAreaElement).value + text;
    fireEvent.change(field, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
    return;
  }
  act(() => {
    for (const char of text) {
      editor.update(
        () => {
          let selection = $getSelection();
          if (!$isRangeSelection(selection)) {
            $getRoot().selectEnd();
            selection = $getSelection();
          }
          if (!$isRangeSelection(selection)) return;
          if (char === '\n') selection.insertLineBreak();
          else selection.insertText(char);
        },
        { discrete: true },
      );
    }
  });
}

/** What the field shows: the textarea's value, or the editor's text (a chip counts as its token). */
export function fieldText(field: HTMLElement): string {
  const editor = editorOf(field);
  if (!editor) return (field as HTMLTextAreaElement).value;
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((paragraph) => paragraph.getTextContent())
      .join('\n'),
  );
}

export function placeholderOf(field: HTMLElement): string | null {
  return field.getAttribute('placeholder') ?? field.getAttribute('aria-placeholder');
}

export function pressKey(field: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...init });
  act(() => {
    field.dispatchEvent(event);
  });
  return event;
}

/** The chips the chip field shows, as their tokens; always empty for the textarea. */
export function chipsIn(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-directive-type]')).map((chip) => chip.textContent ?? '');
}
