/**
 * TokenPicker — grouped-by-source token menu (ts153 `WfTokenPicker`, ported
 * onto `TokenDescriptor`/`TokenRef`). Built on the shared `Popover`, with
 * `Hint` wrapping the trigger per the binding conventions (never nested
 * inside it). The caller is the scope boundary: it only ever receives
 * `scopeAt(...)`'s result, so an out-of-scope token simply never appears
 * here — this component does no scoping of its own.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TokenRef } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { sourceKindStyle } from './TokenChip';

export interface TokenPickerProps {
  tokens: TokenDescriptor[];
  onInsert: (ref: TokenRef) => void;
  testId: string;
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

export function TokenPicker({ tokens, onInsert, testId }: TokenPickerProps) {
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
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2 text-caption font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="font-mono text-[11px]">⟨⟩</span>
            Insert
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent data-testid={`${testId}-menu`} align="end" className="max-h-80 w-64 overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group.source} className="mb-1">
            <div className="px-2 py-1 text-caption font-medium text-muted-foreground">{group.source}</div>
            {group.tokens.map((token) => {
              const key = tokenKey(token.ref);
              const isExpandable = Boolean(token.fields && token.fields.length > 0);
              const isOpen = expanded === key;
              const style = sourceKindStyle(token.sourceKind);
              const Icon = style.icon;
              return (
                <div key={key}>
                  <button
                    type="button"
                    data-testid={`${testId}-option-${key}`}
                    onClick={() => handleRowClick(token)}
                    aria-expanded={isExpandable ? isOpen : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span
                      className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', style.tintClass)}
                    >
                      <Icon size={12} className={style.iconClass} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label text-foreground">{token.label}</span>
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
                        className="flex w-full items-center gap-1 rounded-md py-1 pl-9 pr-2 text-left text-caption text-muted-foreground hover:bg-accent"
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
