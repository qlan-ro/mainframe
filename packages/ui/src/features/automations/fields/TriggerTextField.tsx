'use client';

/**
 * TriggerTextField — every text input in an automation. A plain autosizing
 * textarea driving the shared trigger engine directly (no assistant-ui
 * composer coupling): `$` (variables, from `scope`) is always wired; `/`
 * (skills) and `@` (files) are on by default (`triggers='all'`), sourced from
 * `useAutomationTriggerSources` for the field's own `adapterId` — a Codex step
 * must not offer Claude's skills. Fields whose value isn't prose — the
 * worktree branch name is the one T14 site — opt into `'variables-only'`,
 * which also passes `enabled: false` to that hook so they never fire a
 * skills/files fetch they'd never use.
 *
 * Styled on the composer's field classes, minus `text-transparent
 * caret-foreground` — those exist only for the composer's `ComposerHighlight`
 * overlay, which this field doesn't have; porting them verbatim would render
 * invisible text. `bare` drops the field's own chrome for fields embedded in
 * a card that already draws one (the Agent step's prompt); `mono` is for
 * fields whose value is code or an identifier.
 */
import { useMemo, useRef, type KeyboardEvent } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { useTriggerField } from '@/components/trigger-engine/use-trigger-field';
import { TriggerFieldPopover } from '@/components/trigger-engine/TriggerFieldPopover';
import type { TriggerConfig } from '@/components/trigger-engine/types';
import { literalDirectiveFormatter } from '@/features/chat/composer/triggers/directive-formatter';
import { buildVariablesTriggerAdapter } from './variables-trigger-adapter';
import { useAutomationTriggerSources } from './use-automation-trigger-sources';
import { VariablePickerButton } from './VariablePickerButton';

export interface TriggerTextFieldProps {
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  minHeight?: number;
  testId: string;
  scope: TokenDescriptor[];
  /** Default `'all'` (`$` + `/` + `@`). `'variables-only'` fires just `$`. */
  triggers?: 'all' | 'variables-only';
  /**
   * The adapter whose skills `/` lists — the owning agent step's `adapterId`.
   * Absent, the fields that belong to no step (Notify, Set value, action
   * inputs) take the first installed adapter that serves skills.
   */
  adapterId?: string;
  /** Drops the field's own border/background — for fields embedded in a card that already draws one. */
  bare?: boolean;
  /** Monospace value, for fields whose content is code or an identifier. */
  mono?: boolean;
}

export function TriggerTextField({
  value,
  onChange,
  placeholder,
  minHeight = 36,
  testId,
  scope,
  triggers = 'all',
  adapterId,
  bare = false,
  mono = false,
}: TriggerTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const showAll = triggers === 'all';

  const variablesAdapter = useMemo(() => buildVariablesTriggerAdapter(scope), [scope]);
  const sourceTriggers = useAutomationTriggerSources(adapterId, { enabled: showAll });

  const triggerConfigs: TriggerConfig[] = useMemo(() => {
    const variableTrigger: TriggerConfig = {
      char: '$',
      adapter: variablesAdapter,
      formatter: literalDirectiveFormatter('$'),
      itemTestIdPrefix: `${testId}-variable-item`,
    };
    return showAll ? [variableTrigger, ...sourceTriggers] : [variableTrigger];
  }, [variablesAdapter, sourceTriggers, showAll, testId]);

  const field = useTriggerField({ value, onChange, triggers: triggerConfigs, textareaRef });

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Never consumes a bare Enter itself — no-popover Enter falls through to
    // the textarea's own default newline insertion (automations fields never
    // submit on Enter, unlike the composer).
    field.handleKeyDown(e);
  }

  return (
    // `w-80` is the list's width today; the composer's anchor-width default would
    // widen it to the whole form column.
    <TriggerFieldPopover field={field} testId={`${testId}-trigger-popover`} side="bottom" className="w-80">
      <div
        data-testid={`${testId}-container`}
        className={cn('relative', !bare && 'rounded-md border-[0.5px] border-input bg-card')}
        style={{ minHeight }}
      >
        <TextareaAutosize
          ref={textareaRef}
          data-testid={testId}
          value={value}
          placeholder={placeholder}
          minRows={1}
          onChange={(e) => {
            onChange(e.target.value);
            field.setCursorPosition(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          onClick={(e) => field.setCursorPosition(e.currentTarget.selectionStart ?? 0)}
          onKeyUp={(e) => field.setCursorPosition(e.currentTarget.selectionStart ?? 0)}
          className={cn(
            'w-full resize-none bg-transparent px-[14px] pr-9 text-sm leading-relaxed',
            bare ? 'pt-[10px] pb-[4px]' : 'py-[10px]',
            mono ? 'font-mono' : 'font-sans',
            'text-foreground outline-none placeholder:text-muted-foreground',
          )}
          {...field.ariaProps}
        />
        <div className="absolute right-1.5 top-1.5">
          <VariablePickerButton
            scope={scope}
            testId={testId}
            value={value}
            onChange={onChange}
            textareaRef={textareaRef}
          />
        </div>
      </div>
    </TriggerFieldPopover>
  );
}
