'use client';

/**
 * A plain-text Lexical field with the composer's chips, for text that lives
 * outside the aui composer: a committed quote segment's prose and a queued
 * message being edited. Controlled by `value` / `onChange` like the textarea it
 * replaces when the chip setting is on, so a token never shows as raw text.
 *
 * It shares the chip node, chip look, caret stepping, paste and typed-token
 * plugins with the live field, but none of its composer wiring: no send, no
 * `@`/`/` menu (as before, those belong to the live field alone), no runtime
 * sync. Enter inserts a new line; `onSubmit` takes ⌘↵.
 */
import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from 'react';
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { HistoryExtension } from '@lexical/history';
import { PlainTextExtension } from '@lexical/plain-text';
import {
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  configExtension,
  defineExtension,
  KEY_ENTER_COMMAND,
  SKIP_DOM_SELECTION_TAG,
} from 'lexical';
import { DirectiveChipProvider, DirectiveNode } from '@assistant-ui/react-lexical';
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';
import { cn } from '@/lib/utils';
import { ComposerChip } from './ComposerChip';
import { ChipCaretPlugin, ChipPastePlugin, TypedChipsPlugin } from './chip-plugins';
import { CHIP_EDITOR_CLASS } from './chip-editor-class';
import { $readEditorText, $setEditorText } from './lexical-edits';
import { useChipFormatter } from './use-chip-formatter';

const chipEditorExtension = defineExtension({
  name: '@mainframe/chip-text-editor',
  namespace: 'mf-chip-text-editor',
  nodes: [DirectiveNode],
  dependencies: [PlainTextExtension, configExtension(HistoryExtension, { delay: 1000 })],
  onError: (error) => console.error('[ChipTextEditor]', error),
});

const VALUE_TAG = 'mf-chip-value';

/** `value` in, edits out. A `value` the editor did not just emit rebuilds it (tokens as chips). */
function ValuePlugin({
  value,
  onChange,
  formatter,
  autoFocus,
}: {
  value: string;
  onChange(text: string): void;
  formatter: Unstable_DirectiveFormatter;
  autoFocus: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const emitted = useRef<string | null>(null);
  const emit = useEffectEvent((text: string) => onChange(text));

  useEffect(() => {
    if (value === emitted.current) return;
    const first = emitted.current === null;
    emitted.current = value;
    const tag = first && autoFocus ? VALUE_TAG : [VALUE_TAG, SKIP_DOM_SELECTION_TAG];
    editor.update(() => $setEditorText(value, formatter), {
      tag,
      onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined),
    });
    if (first && autoFocus) editor.focus(undefined, { defaultSelection: 'rootEnd' });
  }, [editor, value, formatter, autoFocus]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState, tags, dirtyElements, dirtyLeaves }) => {
        if (tags.has(VALUE_TAG) || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return;
        const text = editorState.read($readEditorText);
        if (text === emitted.current) return;
        emitted.current = text;
        emit(text);
      }),
    [editor],
  );
  return null;
}

/** ⌘↵ / ⌃↵ submits; a plain ↵ stays a new line. */
function SubmitPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!onSubmit) return undefined;
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event || !(event.metaKey || event.ctrlKey)) return false;
        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit]);
  return null;
}

function EditablePlugin({ readOnly }: { readOnly: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!readOnly), [editor, readOnly]);
  return null;
}

function placeholderProps(placeholder: string | undefined, boxClassName: string | undefined) {
  if (!placeholder) return { placeholder: null };
  return {
    placeholder: <div className={cn('aui-lexical-placeholder top-0 left-0', boxClassName)}>{placeholder}</div>,
    'aria-placeholder': placeholder,
  };
}

export interface ChipTextEditorProps {
  value: string;
  onChange(text: string): void;
  placeholder?: string;
  testId: string;
  /** Extra attributes for the editable element (`data-segment-id`, say). */
  dataAttributes?: Record<`data-${string}`, string>;
  /** Padding and size classes, applied to the editable element and the placeholder alike. */
  boxClassName?: string;
  className?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  onSubmit?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function ChipTextEditor({
  value,
  onChange,
  placeholder,
  testId,
  dataAttributes,
  boxClassName,
  className,
  autoFocus = false,
  readOnly = false,
  onSubmit,
  onKeyDown,
}: ChipTextEditorProps) {
  const formatter = useChipFormatter();
  return (
    <DirectiveChipProvider value={ComposerChip}>
      <LexicalExtensionComposer extension={chipEditorExtension} contentEditable={null}>
        <div className={cn('relative w-full', CHIP_EDITOR_CLASS, className)}>
          <ContentEditable
            className={cn('aui-lexical-input', boxClassName)}
            data-testid={testId}
            data-noring=""
            {...dataAttributes}
            aria-label={placeholder}
            onKeyDown={onKeyDown}
            {...placeholderProps(placeholder, boxClassName)}
          />
          <ValuePlugin value={value} onChange={onChange} formatter={formatter} autoFocus={autoFocus} />
          <SubmitPlugin onSubmit={onSubmit} />
          <EditablePlugin readOnly={readOnly} />
          <ChipCaretPlugin />
          <ChipPastePlugin formatter={formatter} />
          <TypedChipsPlugin />
        </div>
      </LexicalExtensionComposer>
    </DirectiveChipProvider>
  );
}
