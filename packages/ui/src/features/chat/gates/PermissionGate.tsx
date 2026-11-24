import { useState } from 'react';
import { ChevronRight, ShieldIcon, TerminalIcon } from 'lucide-react';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import { artifactPermissionInput, describeArtifactCall } from '@/features/chat/tools/cards/artifact-call';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead, GATE_BODY_INSET, GATE_PRIMARY } from './shared/GateShell';
import { buildOptionResponse } from './build-control-response';
import { gateEyebrow, type GateContext, type ReplyFn } from './gate-types';
import { savedRule } from './saved-rule';

export type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolNameRow({ toolName, command }: { toolName: string; command?: string }) {
  return (
    <div className={cn('px-4 pb-1', GATE_BODY_INSET)}>
      <div className="flex items-center gap-2">
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-sm font-semibold text-foreground">{toolName}</span>
      </div>
      {command && (
        <p
          data-testid="chat-permission-command"
          className="mt-1 max-h-24 overflow-y-auto font-mono text-xs leading-normal wrap-anywhere whitespace-pre-wrap text-foreground/80"
        >
          {command}
        </p>
      )}
    </div>
  );
}

function DetailsDisclosure({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('px-4 pb-3', GATE_BODY_INSET)}>
      <button
        data-testid="chat-permission-details-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-6 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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

function OptionsFooter({
  options,
  rule,
  onSelect,
}: {
  options: PermissionOption[];
  /** What "always" saves, named on its button. */
  rule: string | null;
  onSelect: (option: PermissionOption) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      {options.map((option) => (
        <Button
          key={option.optionId}
          variant={KIND_VARIANT[option.kind as PermissionOptionKind] ?? 'secondary'}
          size="sm"
          className={option.kind === 'allow_once' ? GATE_PRIMARY : undefined}
          data-testid={`chat-permission-option-${option.optionId}`}
          onClick={() => onSelect(option)}
        >
          {option.name}
          {option.kind === 'allow_always' && rule && (
            <code
              data-testid="chat-permission-rule"
              className="max-w-60 truncate rounded bg-muted px-1 font-mono text-xs text-muted-foreground"
            >
              {rule}
            </code>
          )}
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
  context?: GateContext;
}

const ARTIFACT_TOOL = 'Artifact';

/** The row and details a request shows; only `Artifact` needs translating. */
function requestSummary(toolName: string, input: Record<string, unknown>) {
  if (toolName !== ARTIFACT_TOOL) return { name: toolName, details: input };
  const details = artifactPermissionInput(input);
  const { verb, label } = describeArtifactCall(details, '');
  return { name: label ? `${verb}: ${label}` : verb, details };
}

/** The command a shell-like request runs, shown without opening the details. */
function commandOf(input: Record<string, unknown>): string | undefined {
  return typeof input.command === 'string' && input.command.trim() ? input.command : undefined;
}

export function PermissionGate({ entry, reply, context }: PermissionGateProps) {
  const { request } = entry;
  const { name, details } = requestSummary(request.toolName, request.input);

  // The clicked option's own id travels with the answer (spec decision 12 —
  // the daemon sees which offered option was actually selected, not a
  // client-synthesized stand-in), alongside the rich ControlResponse it maps to.
  const onSelect = (option: PermissionOption) => void reply(buildOptionResponse(entry, option), option.optionId);

  return (
    <div data-testid="chat-permission-gate">
      <GateCardShell accent="warning">
        <GateHead
          icon={<ShieldIcon className="size-3.5" />}
          tileClassName="bg-warning/10 text-warning"
          eyebrow={gateEyebrow('Permission required', context)}
          title={context?.title ?? 'Permission Required'}
        />
        <ToolNameRow toolName={name} command={commandOf(request.input)} />
        <DetailsDisclosure input={details} />
        <OptionsFooter options={entry.options} rule={savedRule(request.suggestions)} onSelect={onSelect} />
      </GateCardShell>
    </div>
  );
}
