import { useState } from 'react';
import { ChevronRight, ShieldIcon, TerminalIcon } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead, GATE_BODY_INSET } from './shared/GateShell';
import { buildOptionResponse } from './build-control-response';
import type { ReplyFn } from './gate-types';

export type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolNameRow({ toolName }: { toolName: string }) {
  return (
    <div className={cn('flex items-center gap-2 px-4 pb-2', GATE_BODY_INSET)}>
      <TerminalIcon className="size-3.5 text-muted-foreground" />
      <span className="font-mono text-sm font-semibold text-foreground">{toolName}</span>
    </div>
  );
}

function DetailsDisclosure({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('px-4 pb-3', GATE_BODY_INSET)}>
      <button
        data-testid="chat-permission-details-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        Details
      </button>
      {open && (
        // `bg-muted`, not the terminal palette: this is a JSON payload dump, the
        // same surface ToolFallback's args pre sits on — not terminal output.
        <pre
          data-testid="chat-permission-details-pre"
          className="mt-2 max-h-60 animate-in overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground duration-150 fade-in-0 slide-in-from-top-1"
        >
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];

/**
 * Visual treatment keyed by `kind`, never by `optionId`/`name` (spec decision
 * 12). A kind outside this map — an adapter extension the client doesn't
 * recognize yet — still renders, styled neutrally by the `secondary` fallback
 * below; it is never dropped, and its styling is never guessed from its id or
 * label.
 */
const KIND_VARIANT: Partial<Record<PermissionOptionKind, ButtonVariant>> = {
  allow_once: 'outline',
  allow_always: 'default',
  reject_once: 'destructive',
  reject_always: 'destructive',
};

function OptionsFooter({
  options,
  onSelect,
}: {
  options: PermissionOption[];
  onSelect: (option: PermissionOption) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      {options.map((option) => (
        <Button
          key={option.optionId}
          variant={KIND_VARIANT[option.kind] ?? 'secondary'}
          size="sm"
          data-testid={`chat-permission-option-${option.optionId}`}
          onClick={() => onSelect(option)}
        >
          {option.name}
        </Button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PermissionGate
// ---------------------------------------------------------------------------

export interface PermissionGateProps {
  entry: ChatPermissionEntry;
  /** Called with the response for whichever adapter-supplied option the user picked. */
  reply: ReplyFn;
}

export function PermissionGate({ entry, reply }: PermissionGateProps) {
  const { request } = entry;

  const onSelect = (option: PermissionOption) => void reply(buildOptionResponse(entry, option));

  return (
    <div data-testid="chat-permission-gate">
      <GateCardShell accent="warning">
        <GateHead
          icon={<ShieldIcon className="size-3.5" />}
          tileClassName="bg-warning/10 text-warning"
          eyebrow="Permission required"
          title="Permission Required"
        />
        <ToolNameRow toolName={request.toolName} />
        <DetailsDisclosure input={request.input} />
        <OptionsFooter options={entry.options} onSelect={onSelect} />
      </GateCardShell>
    </div>
  );
}
