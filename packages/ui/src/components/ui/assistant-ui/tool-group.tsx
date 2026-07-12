'use client';

import { memo, useCallback, useRef, useState, type FC, type PropsWithChildren } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { useScrollLock } from '@assistant-ui/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const ANIMATION_DURATION = 200;

// ── Variants ──────────────────────────────────────────────────────────────────
// Warm-chrome restyle: outline = hairline card, muted = muted-tinted card.
// Colors via --mf-* tokens; no /opacity modifier (hex vars trap).

const toolGroupVariants = cva('aui-tool-group-root group/tool-group w-full', {
  variants: {
    variant: {
      outline: 'rounded-lg border border-border bg-card py-3',
      ghost: '',
      muted: 'rounded-lg border border-border bg-muted py-3',
    },
  },
  defaultVariants: { variant: 'outline' },
});

// ── Root ─────────────────────────────────────────────────────────────────────

export type ToolGroupRootProps = Omit<React.ComponentProps<typeof Collapsible>, 'open' | 'onOpenChange'> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) lockScroll();
      if (!isControlled) setUncontrolledOpen(open);
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={variant ?? 'outline'}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(toolGroupVariants({ variant }), 'group/tool-group-root', className)}
      style={{ '--animation-duration': `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      {children}
    </Collapsible>
  );
}

// ── Trigger ───────────────────────────────────────────────────────────────────

function ToolGroupTrigger({
  count,
  active = false,
  label: labelProp,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
  active?: boolean;
  /** Overrides the default "{N} tool calls" label (e.g. a synthesized summary). */
  label?: string;
}) {
  const label = labelProp ?? `${count} tool ${count === 1 ? 'call' : 'calls'}`;
  const countLabel = `${count} ${count === 1 ? 'call' : 'calls'}`;

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      aria-busy={active}
      className={cn(
        'aui-tool-group-trigger group/trigger flex items-center gap-1.5',
        'text-caption text-muted-foreground transition-colors hover:text-foreground',
        'group-data-[variant=outline]/tool-group-root:w-full group-data-[variant=outline]/tool-group-root:px-3',
        'group-data-[variant=muted]/tool-group-root:w-full group-data-[variant=muted]/tool-group-root:px-3',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon
        data-slot="tool-group-trigger-chevron"
        className={cn(
          'aui-tool-group-trigger-chevron size-3.5 shrink-0',
          'transition-transform duration-(--animation-duration) ease-out',
          'group-data-[state=closed]/trigger:-rotate-90',
          'group-data-[state=open]/trigger:rotate-0',
        )}
      />
      <span
        data-testid="tool-group-trigger-label"
        data-slot="tool-group-trigger-label"
        className={cn('aui-tool-group-trigger-label-wrapper text-start leading-none font-medium text-foreground')}
      >
        {label}
      </span>
      <span
        data-testid="tool-group-trigger-count"
        data-slot="tool-group-trigger-count"
        className="font-mono text-caption text-muted-foreground"
      >
        {countLabel}
      </span>
      <span
        className={cn(
          'aui-tool-group-trigger-spacer',
          'group-data-[variant=outline]/tool-group-root:grow',
          'group-data-[variant=muted]/tool-group-root:grow',
        )}
      />
    </CollapsibleTrigger>
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

function ToolGroupContent({ className, children, ...props }: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        'aui-tool-group-content relative overflow-hidden text-body outline-none',
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
      <div
        className={cn(
          'mt-2 flex flex-col gap-2',
          'group-data-[variant=outline]/tool-group-root:mt-3 group-data-[variant=outline]/tool-group-root:border-t group-data-[variant=outline]/tool-group-root:border-border group-data-[variant=outline]/tool-group-root:px-3 group-data-[variant=outline]/tool-group-root:pt-3',
          'group-data-[variant=muted]/tool-group-root:mt-3 group-data-[variant=muted]/tool-group-root:border-t group-data-[variant=muted]/tool-group-root:border-border group-data-[variant=muted]/tool-group-root:px-3 group-data-[variant=muted]/tool-group-root:pt-3',
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

// ── Compound component ────────────────────────────────────────────────────────

type ToolGroupComponent = FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> & {
  Root: typeof ToolGroupRoot;
  Trigger: typeof ToolGroupTrigger;
  Content: typeof ToolGroupContent;
};

const ToolGroupImpl: FC<PropsWithChildren<{ startIndex: number; endIndex: number }>> = ({
  children,
  startIndex,
  endIndex,
}) => {
  const toolCount = endIndex - startIndex + 1;

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/**
 * Legacy wrapper for `components.ToolGroup` prop on `<MessagePrimitive.Parts>`.
 * Prefer `<MessagePrimitive.GroupedParts>` with `groupBy` + ToolGroupRoot/Trigger/Content.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent;

ToolGroup.displayName = 'ToolGroup';
ToolGroup.Root = ToolGroupRoot;
ToolGroup.Trigger = ToolGroupTrigger;
ToolGroup.Content = ToolGroupContent;

export { ToolGroup, ToolGroupRoot, ToolGroupTrigger, ToolGroupContent, toolGroupVariants };
