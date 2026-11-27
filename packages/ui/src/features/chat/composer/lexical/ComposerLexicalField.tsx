'use client';

/**
 * The composer field as a Lexical editor with atomic chips, in place of
 * `ComposerPrimitive.Input` and the colour overlay behind it. Shown when the
 * "Mentions and commands as chips" setting is on (`ui-prefs.chipComposer`);
 * loaded lazily (`lazy-fields.ts`).
 *
 * `LexicalComposerInput` keeps the text in the same aui composer, so drafts
 * per thread, attachments, the send path and the wire text are unchanged. The
 * trigger engine reaches it through the same composer-input plugin registry.
 */
import { LexicalComposerInput } from '@assistant-ui/react-lexical';
import { useTriggerFieldAria } from '../triggers/trigger-field-aria-context';
import { ComposerChip } from './ComposerChip';
import { ChipCaretPlugin, ChipPastePlugin, TypedChipsPlugin } from './chip-plugins';
import { AttachmentPastePlugin, ComposerBridgePlugin, ComposerKeysPlugin } from './composer-lexical-plugins';
import type { LexicalComposerBridge } from './lexical-bridge';
import { useChipFormatter } from './use-chip-formatter';
import { CHIP_EDITOR_CLASS } from './chip-editor-class';

const PLACEHOLDER_AT_PADDING = '[&_.aui-lexical-placeholder]:top-0.5 [&_.aui-lexical-placeholder]:left-1';

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
      className={`relative w-full px-1 pt-0.5 pb-2 ${CHIP_EDITOR_CLASS} ${PLACEHOLDER_AT_PADDING}`}
    >
      <ComposerBridgePlugin bridge={bridge} aria={aria} />
      <ComposerKeysPlugin onEnter={onEnter} onShiftTab={onShiftTab} />
      <ChipCaretPlugin />
      <AttachmentPastePlugin />
      <ChipPastePlugin formatter={formatter} />
      <TypedChipsPlugin />
    </LexicalComposerInput>
  );
}
