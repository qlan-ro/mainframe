'use client';

/**
 * TriggerTextField — the `ChipField` replacement. A plain autosizing
 * textarea driving the shared trigger engine directly (no assistant-ui
 * composer coupling): `$` (variables, from `scope`) is always wired; `/`
 * (skills) and `@` (files) are on by default (`triggers='all'`), sourced from
 * `useAutomationTriggerSources`. Fields whose value isn't prose — the
 * worktree branch name is the one T14 site — opt into `'variables-only'`,
 * which also passes `enabled: false` to that hook so they never fire a
 * skills/files fetch they'd never use.
 *
 * Styled on the composer's field classes, minus `text-transparent
 * caret-foreground` — those exist only for the composer's `ComposerHighlight`
 * overlay, which this field doesn't have; porting them verbatim would render
 * invisible text.
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
}

export function TriggerTextField({
  value,
  onChange,
  placeholder,
  minHeight = 36,
  testId,
  scope,
  triggers = 'all',
}: TriggerTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const showAll = triggers === 'all';

  const variablesAdapter = useMemo(() => buildVariablesTriggerAdapter(scope), [scope]);
  const sourceTriggers = useAutomationTriggerSources(undefined, { enabled: showAll });

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
    <div
      data-testid={`${testId}-container`}
      className="relative rounded-md border-[0.5px] border-input bg-card"
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
          'w-full resize-none bg-transparent px-[14px] py-[10px] pr-9 font-sans text-body leading-relaxed',
          'text-foreground outline-none placeholder:text-mf-text-3',
        )}
        {...field.ariaProps}
      />
      <div className="absolute right-1.5 top-1.5">
        <VariablePickerButton scope={scope} testId={testId} value={value} onChange={onChange} textareaRef={textareaRef} />
      </div>
      <TriggerFieldPopover field={field} testId={`${testId}-trigger-popover`} className="absolute left-0 top-full mt-1" />
    </div>
  );
}
