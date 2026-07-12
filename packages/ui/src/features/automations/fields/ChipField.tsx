/**
 * ChipField — the chip-part editor (ts153 `WfChipField`, ported onto the
 * ratified `ChipText = Array<string | {token: TokenRef}>`). Structural
 * editing only: insert/remove a part, merge the draft tail, backspace pops
 * the last part — never string parsing.
 *
 * A committed part is `{token: TokenRef}`, never a display descriptor —
 * rendering resolves each token against the `tokens` scope prop (see
 * `TokenChip`'s doc comment). A ref that isn't in `tokens` renders a
 * "Missing value" fallback instead of crashing.
 *
 * Slash commands (leading "/") are a fast-insert affordance, not a distinct
 * chip-part kind — selecting one commits ordinary literal text. See
 * `SlashMenu`'s doc comment for why the contract rules out a third part
 * shape.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import type { ChipText, TokenRef } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { isTokenPart, mergeDraftTail } from '../domain/chip-parts';
import { matchSlashCommands, SlashMenu } from './SlashMenu';
import { TokenChip } from './TokenChip';
import { TokenPicker } from './TokenPicker';

export interface ChipFieldProps {
  value: ChipText;
  onChange: (next: ChipText) => void;
  /** The current token scope — both the picker's options and how committed chips resolve their display. */
  tokens: TokenDescriptor[];
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  minHeight?: number;
  /** Enables the leading-"/" slash-command menu (agent prompt fields only). */
  slash?: boolean;
  testId: string;
}

function resolveToken(tokens: TokenDescriptor[], ref: TokenRef): TokenDescriptor | null {
  return tokens.find((t) => t.ref.stepId === ref.stepId && t.ref.output === ref.output) ?? null;
}

export function ChipField({
  value,
  onChange,
  tokens,
  placeholder,
  multiline,
  mono,
  minHeight,
  slash,
  testId,
}: ChipFieldProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function commitDraft() {
    if (!draft) return;
    onChange(mergeDraftTail(value, draft));
    setDraft('');
  }

  function insertTokenRef(ref: TokenRef) {
    const next = draft ? mergeDraftTail(value, draft) : value.slice();
    next.push({ token: ref });
    onChange(next);
    setDraft('');
    inputRef.current?.focus();
  }

  function insertSlashCommand(command: string) {
    onChange(mergeDraftTail(value, command));
    setDraft('');
    inputRef.current?.focus();
  }

  const slashOpen = Boolean(slash && draft.startsWith('/'));

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (slashOpen && e.key === 'Enter') {
      e.preventDefault();
      const matches = matchSlashCommands(draft);
      insertSlashCommand(matches[0] ?? draft);
      return;
    }
    if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      removeAt(value.length - 1);
      return;
    }
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      commitDraft();
    }
  }

  return (
    <div
      data-testid={testId}
      onClick={() => inputRef.current?.focus()}
      className="relative box-border flex w-full cursor-text flex-wrap items-center gap-[5px] rounded-md border-[0.5px] border-input bg-card px-[8px] py-1.5"
      style={{ minHeight: minHeight ?? (multiline ? 60 : 32) }}
    >
      {value.map((part, i) => {
        if (isTokenPart(part)) {
          const descriptor = resolveToken(tokens, part.token);
          const chipKey = `${part.token.stepId}-${part.token.output}${part.token.field ? `-${part.token.field}` : ''}`;
          return (
            <TokenChip
              key={i}
              descriptor={descriptor}
              field={part.token.field}
              onRemove={() => removeAt(i)}
              testId={`${testId}-chip-${chipKey}`}
            />
          );
        }
        return (
          <span key={i} className={cn('whitespace-pre-wrap text-body text-foreground', mono && 'font-mono')}>
            {part}
          </span>
        );
      })}
      <input
        ref={inputRef}
        data-testid={`${testId}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
        placeholder={value.length === 0 ? placeholder : undefined}
        className={cn(
          'min-w-[60px] flex-1 border-none bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground',
          mono && 'font-mono',
        )}
      />
      <TokenPicker tokens={tokens} onInsert={insertTokenRef} testId={`${testId}-picker`} small label="" align="end" />
      {slashOpen && <SlashMenu query={draft} onSelect={insertSlashCommand} testId={`${testId}-slash-menu`} />}
    </div>
  );
}
