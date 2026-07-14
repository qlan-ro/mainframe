/**
 * TokenPicker — grouped-by-source token menu (ts153 `WfTokenPicker`, ported
 * onto `TokenDescriptor`/`TokenRef`). Built on the shared `Popover`, with
 * `Hint` wrapping the trigger per the binding conventions (never nested
 * inside it). The caller is the scope boundary: it only ever receives
 * `scopeAt(...)`'s result, so an out-of-scope token simply never appears
 * here — this component does no scoping of its own.
 *
 * A token carrying `TokenDescriptor.description` (todo #234 bullet 5 — e.g.
 * an agent step's "Result", to distinguish it from the parsed `expects`
 * fields) surfaces it as the row's native `title`, matching this feature's
 * existing native-tooltip spot (`LibraryRow`'s Run button) rather than
 * adding a second tooltip mechanism for one row.
 *
 * `small`/`label`/`align` mirror ts153's variant API: `ChipField` embeds an
 * icon-only, right-anchored picker (`small`, `label=""`, `align="end"`);
 * standalone callers (e.g. a "pick a result" row) get the default 24px
 * trigger with a visible label, left-anchored.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TokenRef } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { sourceKindStyle, tokenIcon } from './TokenChip';

export interface TokenPickerProps {
  tokens: TokenDescriptor[];
  onInsert: (ref: TokenRef) => void;
  testId: string;
  /** Compact 20px trigger for embedded use (e.g. inside `ChipField`); default is the standalone 24px size. */
  small?: boolean;
  /** Trigger label text — pass `''` for an icon-only trigger. */
  label?: string;
  /** Popover alignment relative to the trigger. */
  align?: 'start' | 'end';
}

interface TokenGroup {
  source: string;
  tokens: TokenDescriptor[];
}

function groupBySource(tokens: TokenDescriptor[]): TokenGroup[] {
  const order: string[] = [];
  const bySource = new Map<string, TokenDescriptor[]>();
  for (const token of tokens) {
    if (!bySource.has(token.source)) {
      bySource.set(token.source, []);
      order.push(token.source);
    }
    bySource.get(token.source)!.push(token);
  }
  return order.map((source) => ({ source, tokens: bySource.get(source)! }));
}

function tokenKey(ref: TokenRef): string {
  return `${ref.stepId}-${ref.output}`;
}

export function TokenPicker({ tokens, onInsert, testId, small, label = 'Insert', align = 'start' }: TokenPickerProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const hasTokens = tokens.length > 0;
  const groups = groupBySource(tokens);

  function close() {
    setOpen(false);
    setExpanded(null);
  }

  function handleRowClick(token: TokenDescriptor) {
    if (token.fields && token.fields.length > 0) {
      const key = tokenKey(token.ref);
      setExpanded((prev) => (prev === key ? null : key));
      return;
    }
    onInsert(token.ref);
    close();
  }

  function handleFieldClick(token: TokenDescriptor, field: string) {
    onInsert({ ...token.ref, field });
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setExpanded(null);
      }}
    >
      <Hint label={hasTokens ? 'Insert a value from an earlier step' : 'No values available yet'}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={testId}
            disabled={!hasTokens}
            className={cn(
              'inline-flex shrink-0 items-center gap-[4px] rounded-full border-[0.5px] border-border bg-card px-[8px] text-caption font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45',
              small ? 'h-[20px]' : 'h-[24px]',
            )}
          >
            <span className="font-mono text-caption">⟨⟩</span>
            {label}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent data-testid={`${testId}-menu`} align={align} className="max-h-80 w-64 overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group.source} className="mb-[4px]">
            <div className="px-[8px] pb-[4px] pt-[5px] text-caption font-medium text-muted-foreground">
              {group.source}
            </div>
            {group.tokens.map((token) => {
              const key = tokenKey(token.ref);
              const isExpandable = Boolean(token.fields && token.fields.length > 0);
              const isOpen = expanded === key;
              const style = sourceKindStyle(token.sourceKind);
              const Icon = tokenIcon(token);
              return (
                <div key={key}>
                  <button
                    type="button"
                    data-testid={`${testId}-option-${key}`}
                    onClick={() => handleRowClick(token)}
                    aria-expanded={isExpandable ? isOpen : undefined}
                    title={token.description}
                    className="flex w-full items-center gap-[9px] rounded-md px-[8px] py-[7px] text-left hover:bg-accent"
                  >
                    <span
                      className={cn(
                        'flex size-[20px] shrink-0 items-center justify-center rounded-md',
                        style.tintClass,
                      )}
                    >
                      <Icon size={12} className={style.iconClass} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-foreground">{token.label}</span>
                    <span className="text-caption text-muted-foreground">{token.type}</span>
                    {isExpandable && (
                      <ChevronRight
                        size={12}
                        className={cn('shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
                        aria-hidden
                      />
                    )}
                  </button>
                  {isOpen &&
                    token.fields!.map((field) => (
                      <button
                        key={field}
                        type="button"
                        data-testid={`${testId}-option-${key}-${field}`}
                        onClick={() => handleFieldClick(token, field)}
                        className="flex w-full items-center gap-[8px] rounded-md py-[5px] pl-[37px] pr-[8px] text-left text-body text-muted-foreground hover:bg-accent"
                      >
                        {token.label} <span>›</span> <span className="font-medium text-foreground">{field}</span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
