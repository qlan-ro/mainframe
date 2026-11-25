import { useId, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import { GATE_PRIMARY } from './shared/GateShell';
import type { GrantLine } from './permission-grants';
import { PermissionReadDialog } from './PermissionReadDialog';
import type { AllowedPart, ShownToEnd } from './use-shown-to-end';

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

interface FooterProps {
  options: PermissionOption[];
  grants: readonly GrantLine[];
  parts: readonly AllowedPart[];
  shown: ShownToEnd;
  onSelect: (option: PermissionOption) => void;
}

function focusAnswer(root: HTMLDivElement | null) {
  const target =
    root?.querySelector<HTMLElement>('[data-gate-show-rest]') ??
    root?.querySelector<HTMLElement>('button:not([aria-disabled="true"]):not(:disabled)');
  target?.focus();
}

/**
 * The request may be gone, or replaced, by the time the reader closes. Focus then
 * goes to the next request as a whole, never to one of its answers: a key pressed
 * for the text just read must not answer one that wasn't.
 */
function restoreReadFocus(footer: HTMLDivElement | null, thread: Element | null) {
  if (footer) return focusAnswer(footer);
  if (!thread?.isConnected || document.activeElement !== document.body) return;
  const next = thread.querySelector<HTMLElement>('[data-chat-gate]');
  if (next) next.tabIndex = -1;
  (next ?? thread.querySelector<HTMLElement>('[data-mf-composer-input]'))?.focus();
}

function ShowRest({ part, onShow }: { part: AllowedPart; onShow: () => void }) {
  return (
    <div className="basis-full">
      <Button
        variant="outline"
        size="sm"
        data-testid="chat-permission-show-rest"
        data-gate-show-rest
        onClick={(event) => {
          if (event.detail <= 1) onShow();
        }}
      >
        <ArrowDown data-icon="inline-start" />
        Show the rest of {part.name}
      </Button>
    </div>
  );
}

function PermissionAnswer({
  option,
  grants,
  lockedId,
  onSelect,
}: Pick<FooterProps, 'grants' | 'onSelect'> & {
  option: PermissionOption;
  lockedId: string | undefined;
}) {
  const blocked = lockedId !== undefined && !REFUSING.includes(option.kind);
  return (
    <Button
      variant={KIND_VARIANT[option.kind as PermissionOptionKind] ?? 'secondary'}
      size="sm"
      className={cn('aria-disabled:cursor-not-allowed aria-disabled:opacity-50', {
        [GATE_PRIMARY]: option.kind === 'allow_once',
      })}
      data-testid={`chat-permission-option-${option.optionId}`}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? lockedId : undefined}
      onClick={() => {
        if (!blocked) onSelect(option);
      }}
    >
      {option.name}
      {option.kind === 'allow_always' && <SavedBadge grants={grants} />}
    </Button>
  );
}

export function OptionsFooter({ options, grants, parts, shown, onSelect }: FooterProps) {
  const lockedId = useId();
  const { rest, locked } = shown;
  const footer = useRef<HTMLDivElement>(null);
  const thread = useRef<Element | null>(null);
  const [readingId, setReadingId] = useState<string>();
  const reading = parts.find((part) => part.id === readingId);
  return (
    // Stays in view while a long list scrolls behind it, unless the window is too short to spare
    // the room. `-bottom-1` reaches past the slot's own padding, so nothing shows under it.
    <div
      ref={footer}
      data-testid="chat-permission-options"
      data-gate-answers
      className="flex flex-wrap items-center gap-2 bg-card px-4 pb-3 [@container_(min-height:26rem)]:sticky [@container_(min-height:26rem)]:-bottom-1 [@container_(min-height:26rem)]:pt-1"
    >
      {rest && (
        <ShowRest
          part={rest}
          onShow={() => {
            if (!shown.showRest()) {
              thread.current = footer.current?.closest('[data-testid="chat-thread"]') ?? null;
              setReadingId(rest.id);
            }
          }}
        />
      )}
      {reading && (
        <PermissionReadDialog
          part={reading}
          onClose={() => setReadingId(undefined)}
          onRestoreFocus={() => restoreReadFocus(footer.current, thread.current)}
          onRead={() => shown.confirmRest(reading)}
        />
      )}
      {locked && (
        <span id={lockedId} className="sr-only">
          Not available until you have seen the end of {rest?.name ?? 'the request'}.
        </span>
      )}
      {options.map((option) => (
        <PermissionAnswer
          key={option.optionId}
          option={option}
          grants={grants}
          lockedId={locked ? lockedId : undefined}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
