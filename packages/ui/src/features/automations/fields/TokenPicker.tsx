/**
 * TokenPicker — grouped-by-source token menu (ts153 `WfTokenPicker`, ported
 * onto `TokenDescriptor`/`TokenRef`). A pick-one list of choices, so it is a
 * native `DropdownMenu` with a Group per source, with `Hint` wrapping the
 * trigger per the binding conventions (never nested
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
 * Text fields reference values by name now, so the only callers left are the
 * two structural pickers — an if-condition's left side and a repeat's list.
 * Both want the same standalone trigger, which is why this has no variants.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TokenRef } from '../contract';
import type { TokenDescriptor } from '../domain/tokens';
import { sourceKindStyle, tokenIcon } from './TokenChip';

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

interface TokenRowsProps {
  token: TokenDescriptor;
  testId: string;
  expanded: boolean;
  onToggle: () => void;
  onInsert: (ref: TokenRef) => void;
}

/** One token's item, plus its field items while expanded. */
function TokenRows({ token, testId, expanded, onToggle, onInsert }: TokenRowsProps) {
  const key = tokenKey(token.ref);
  const isExpandable = Boolean(token.fields && token.fields.length > 0);
  const style = sourceKindStyle(token.sourceKind);
  const Icon = tokenIcon(token);

  return (
    <>
      <Hint label={token.description} side="right">
        <DropdownMenuItem
          data-testid={`${testId}-option-${key}`}
          aria-expanded={isExpandable ? expanded : undefined}
          onSelect={(e) => {
            // Expanding is not a choice — keep the menu open so the fields show.
            if (isExpandable) {
              e.preventDefault();
              onToggle();
              return;
            }
            onInsert(token.ref);
          }}
        >
          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md', style.tintClass)}>
            <Icon className={cn('size-3', style.iconClass)} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate">{token.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{token.type}</span>
          {isExpandable && (
            <ChevronRight
              className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
              aria-hidden
            />
          )}
        </DropdownMenuItem>
      </Hint>
      {expanded &&
        token.fields!.map((field) => (
          <DropdownMenuItem
            key={field}
            data-testid={`${testId}-option-${key}-${field}`}
            className="pl-9 text-muted-foreground"
            onSelect={() => onInsert({ ...token.ref, field })}
          >
            {token.label} <span>›</span> <span className="font-medium text-foreground">{field}</span>
          </DropdownMenuItem>
        ))}
    </>
  );
}

export function TokenPicker({ tokens, onInsert, testId }: TokenPickerProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const hasTokens = tokens.length > 0;
  const groups = groupBySource(tokens);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setExpanded(null);
      }}
    >
      <Hint label={hasTokens ? 'Insert a value from an earlier step' : 'No values available yet'}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid={testId}
            disabled={!hasTokens}
            className="inline-flex h-[24px] shrink-0 items-center gap-[4px] rounded-full border-[0.5px] border-border bg-card px-[8px] text-xs font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="font-mono text-xs">⟨⟩</span>
            Insert
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-testid={`${testId}-menu`} align="start" className="max-h-80 w-64">
        {groups.map((group) => (
          <DropdownMenuGroup key={group.source}>
            <DropdownMenuLabel>{group.source}</DropdownMenuLabel>
            {group.tokens.map((token) => {
              const key = tokenKey(token.ref);
              return (
                <TokenRows
                  key={key}
                  token={token}
                  testId={testId}
                  expanded={expanded === key}
                  onToggle={() => setExpanded((prev) => (prev === key ? null : key))}
                  onInsert={onInsert}
                />
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
