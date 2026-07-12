'use client';

/**
 * Vendored + warm-chrome restyled shadcn Reasoning block.
 * Upstream: assistant-ui/packages/ui reasoning.tsx
 * Deltas: BrainIcon→SparklesIcon, collapsed default, "Thought for Ns" copy,
 * warm-chrome tokens (no /opacity on --mf-* vars), data-testid on trigger.
 */
import { useCallback, useRef, useState } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { SparklesIcon, ChevronDownIcon } from 'lucide-react';
import { useScrollLock } from '@assistant-ui/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const ANIMATION_DURATION = 200;

const reasoningVariants = cva('aui-reasoning-root mb-3 w-full', {
  variants: {
    variant: {
      outline: 'rounded-lg border border-border px-3 py-2',
      ghost: '',
      muted: 'bg-card rounded-lg px-3 py-2',
    },
  },
  defaultVariants: {
    variant: 'outline',
  },
});

export type ReasoningRootProps = Omit<React.ComponentProps<typeof Collapsible>, 'open' | 'onOpenChange'> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        lockScroll();
      }
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('group/reasoning-root', reasoningVariants({ variant, className }))}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ReasoningFade({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="reasoning-fade"
      className={cn(
        'aui-reasoning-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8',
        'bg-[linear-gradient(to_top,var(--color-background),transparent)]',
        'fade-in-0 animate-in',
        'group-data-[state=open]/collapsible-content:animate-out',
        'group-data-[state=open]/collapsible-content:fade-out-0',
        'group-data-[state=open]/collapsible-content:delay-[calc(var(--animation-duration)*0.75)]',
        'group-data-[state=open]/collapsible-content:fill-mode-forwards',
        'duration-(--animation-duration)',
        'group-data-[state=open]/collapsible-content:duration-(--animation-duration)',
        className,
      )}
      {...props}
    />
  );
}

/** Formats seconds → "Thought for Ns" / "Thought for Nm Ns" */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `Thought for ${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `Thought for ${m}m ${s}s` : `Thought for ${m}m`;
}

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  active?: boolean;
  duration?: number;
}) {
  // Live → "Thinking…"; done with a measured duration → "Thought for Ns";
  // done without one (daemon doesn't yet emit a thinking duration) → "Reasoning".
  const label = active ? 'Thinking…' : duration != null ? formatDuration(duration) : 'Reasoning';

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      data-testid="chat-reasoning-toggle"
      className={cn(
        'aui-reasoning-trigger group/trigger text-muted-foreground hover:text-foreground',
        'flex max-w-[75%] items-center gap-1.5 py-1 text-caption transition-colors',
        className,
      )}
      {...props}
    >
      <SparklesIcon
        data-slot="reasoning-trigger-icon"
        className="aui-reasoning-trigger-icon size-3.5 shrink-0 text-primary"
      />
      <span
        data-slot="reasoning-trigger-label"
        className="aui-reasoning-trigger-label-wrapper relative inline-block leading-none"
      >
        <span>{label}</span>
        {active ? (
          <span
            aria-hidden
            data-slot="reasoning-trigger-shimmer"
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            {label}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="reasoning-trigger-chevron"
        className={cn(
          'aui-reasoning-trigger-chevron mt-0.5 size-[10px] shrink-0',
          'transition-transform duration-(--animation-duration) ease-out',
          'group-data-[state=closed]/trigger:-rotate-90',
          'group-data-[state=open]/trigger:rotate-0',
        )}
      />
    </CollapsibleTrigger>
  );
}

function ReasoningContent({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        'aui-reasoning-content text-muted-foreground relative overflow-hidden text-label outline-none',
        'group/collapsible-content ease-out',
        'data-[state=closed]:animate-collapsible-up',
        'data-[state=open]:animate-collapsible-down',
        'data-[state=closed]:fill-mode-forwards',
        'data-[state=closed]:pointer-events-none',
        'data-[state=open]:duration-(--animation-duration)',
        'data-[state=closed]:duration-(--animation-duration)',
        className,
      )}
      {...props}
    >
      {children}
      <ReasoningFade />
    </CollapsibleContent>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        'aui-reasoning-text relative z-0 ms-2.5 max-h-64 space-y-3 overflow-y-auto border-l-2 border-border ps-3.5 pt-1.5 pb-2 leading-relaxed',
        'transform-gpu transition-[transform,opacity]',
        'group-data-[state=open]/collapsible-content:animate-in',
        'group-data-[state=closed]/collapsible-content:animate-out',
        'group-data-[state=open]/collapsible-content:fade-in-0',
        'group-data-[state=closed]/collapsible-content:fade-out-0',
        'group-data-[state=open]/collapsible-content:slide-in-from-top-4',
        'group-data-[state=closed]/collapsible-content:slide-out-to-top-4',
        'group-data-[state=open]/collapsible-content:duration-(--animation-duration)',
        'group-data-[state=closed]/collapsible-content:duration-(--animation-duration)',
        className,
      )}
      {...props}
    />
  );
}

// Composed directly by AssistantMessage's `group-reasoning` case (one
// ReasoningRoot wrapping the grouped reasoning leaves) — the canonical
// GroupedParts pattern, so no ReasoningGroup/leaf wrapper is needed here.
export { ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText, ReasoningFade, reasoningVariants };
