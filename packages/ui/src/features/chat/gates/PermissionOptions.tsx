import { useId } from 'react';
import { ArrowDown } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import { GATE_PRIMARY } from './shared/GateShell';
import type { GrantLine } from './permission-grants';
import type { ShownToEnd } from './use-shown-to-end';

type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];

/**
 * Visual treatment keyed by `kind`, never by `optionId`/`name` (spec decision
 * 12). A kind outside this map — an adapter extension the client doesn't
 * recognize yet, which the boundary schema deliberately lets through (spec
 * decision 25) — still renders, styled neutrally by the `secondary` fallback
 * below; it is never dropped, and its styling is never guessed from its id or
 * label.
 */
const KIND_VARIANT: Partial<Record<PermissionOptionKind, ButtonVariant>> = {
  allow_once: 'default',
  allow_always: 'outline',
  reject_once: 'destructive',
  reject_always: 'destructive',
};

/** What an "always" answer saves, on its own button: the rule, or how many changes. */
function SavedBadge({ grants }: { grants: readonly GrantLine[] }) {
  const badge = 'truncate rounded bg-muted px-1 text-xs text-muted-foreground';
  const [only] = grants;
  if (!only) return null;
  return grants.length === 1 ? (
    <code
      data-testid="chat-permission-rule"
      dir="ltr"
      className={cn(badge, 'stored-order max-w-60 font-mono whitespace-pre')}
    >
      {only.subject}
    </code>
  ) : (
    <span data-testid="chat-permission-grant-count" className={cn(badge, 'tabular-nums')}>
      {grants.length} changes
    </span>
  );
}

/** Only these answers allow nothing; a kind this build does not know counts as allowing. */
const REFUSING: readonly string[] = ['reject_once', 'reject_always'];

export function OptionsFooter({
  options,
  grants,
  shown,
  onSelect,
}: {
  options: PermissionOption[];
  /** What "always" saves. */
  grants: readonly GrantLine[];
  shown: ShownToEnd;
  onSelect: (option: PermissionOption) => void;
}) {
  const lockedId = useId();
  const { rest, locked } = shown;
  return (
    // Stays in view while a long list scrolls behind it, unless the window is too short to spare
    // the room. `-bottom-1` reaches past the slot's own padding, so nothing shows under it.
    <div
      data-testid="chat-permission-options"
      data-gate-answers
      className="flex flex-wrap items-center gap-2 bg-card px-4 pb-3 [@container_(min-height:26rem)]:sticky [@container_(min-height:26rem)]:-bottom-1 [@container_(min-height:26rem)]:pt-1"
    >
      {rest && (
        <div className="basis-full">
          <Button
            variant="outline"
            size="sm"
            data-testid="chat-permission-show-rest"
            data-gate-show-rest
            // The second click of a double-click would pass the next part by unread.
            onClick={(event) => event.detail <= 1 && shown.showRest()}
          >
            <ArrowDown data-icon="inline-start" />
            Show the rest of {rest.name}
          </Button>
        </div>
      )}
      {locked && (
        <span id={lockedId} className="sr-only">
          Not available until you have seen the end of {rest?.name ?? 'the request'}.
        </span>
      )}
      {options.map((option) => {
        const lockedOption = locked && !REFUSING.includes(option.kind);
        return (
          <Button
            key={option.optionId}
            variant={KIND_VARIANT[option.kind as PermissionOptionKind] ?? 'secondary'}
            size="sm"
            className={cn('aria-disabled:cursor-not-allowed aria-disabled:opacity-50', {
              [GATE_PRIMARY]: option.kind === 'allow_once',
            })}
            data-testid={`chat-permission-option-${option.optionId}`}
            // Not `disabled`: it stays in the tab order, and says why.
            aria-disabled={lockedOption || undefined}
            aria-describedby={lockedOption ? lockedId : undefined}
            onClick={() => {
              if (!lockedOption) onSelect(option);
            }}
          >
            {option.name}
            {option.kind === 'allow_always' && <SavedBadge grants={grants} />}
          </Button>
        );
      })}
    </div>
  );
}
