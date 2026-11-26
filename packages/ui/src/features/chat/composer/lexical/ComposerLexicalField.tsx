'use client';

/**
 * Spike (todo #482): the composer field as a Lexical editor with atomic chips,
 * in place of `ComposerPrimitive.Input` and the colour overlay behind it.
 * Behind `isLexicalComposerEnabled()`; see
 * `docs/research/2026-11-26-lexical-chips-spike.md`.
 *
 * `LexicalComposerInput` keeps the text in the same aui composer, so drafts
 * per thread, attachments, the send path and the wire text are unchanged. The
 * trigger engine reaches it through the same composer-input plugin registry.
 */
import { useMemo } from 'react';
import { LexicalComposerInput } from '@assistant-ui/react-lexical';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useSessionReferences } from '../sessions/session-reference-store';
import { useTriggerFieldAria } from '../triggers/trigger-field-aria-context';
import { ComposerChip } from './ComposerChip';
import { createComposerChipFormatter } from './composer-chip-formatter';
import { ComposerBridgePlugin, ComposerKeysPlugin, ComposerPastePlugin } from './composer-lexical-plugins';
import type { LexicalComposerBridge } from './lexical-bridge';

const NO_LABELS: readonly string[] = [];

function useChipFormatter() {
  const threadId = useActiveThreadId();
  const references = useSessionReferences((s) => (threadId == null ? undefined : s.byThread[threadId]));
  const key = references ? Object.keys(references).join('\0') : '';
  // Keyed on the label list, not the record, so the formatter (and the
  // re-parse SyncPlugin runs when it changes) moves only when a label does.
  return useMemo(() => createComposerChipFormatter(key ? key.split('\0') : NO_LABELS), [key]);
}

export function ComposerLexicalField({
  bridge,
  placeholder,
  onEnter,
  onShiftTab,
}: {
  bridge: LexicalComposerBridge;
  placeholder: string;
  onEnter(altKey: boolean): void;
  onShiftTab(): void;
}) {
  const formatter = useChipFormatter();
  const aria = useTriggerFieldAria();
  return (
    <LexicalComposerInput
      data-testid="chat-composer-lexical"
      submitMode="none"
      cancelOnEscape={false}
      autoFocus
      placeholder={placeholder}
      aria-label="Message"
      formatter={formatter}
      directiveChip={ComposerChip}
      style={{ overflowY: 'visible' }}
      className={[
        'relative w-full px-1 pt-0.5 pb-2 font-sans text-composer-input text-foreground',
        '[&_.aui-lexical-input]:min-h-[1lh] [&_.aui-lexical-input]:outline-none',
        '[&_.aui-lexical-input_p]:m-0',
        '[&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute',
        '[&_.aui-lexical-placeholder]:top-0.5 [&_.aui-lexical-placeholder]:left-1 [&_.aui-lexical-placeholder]:text-muted-foreground',
      ].join(' ')}
    >
      <ComposerBridgePlugin bridge={bridge} aria={aria} />
      <ComposerKeysPlugin onEnter={onEnter} onShiftTab={onShiftTab} />
      <ComposerPastePlugin formatter={formatter} />
    </LexicalComposerInput>
  );
}
