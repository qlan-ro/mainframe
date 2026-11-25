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
import { grantLines, readSuggestions, type GrantLine } from './permission-grants';
import { visibleLine, visibleText } from './visible-text';

export type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** The command is shown whole: the gate's slot scrolls it, with the answers in view, and the count says how far it goes. */
function ToolNameRow({ toolName, command }: { toolName: string; command?: string }) {
  const lines = command?.split('\n').length ?? 0;
  return (
    <div className={cn('px-4 pb-1', GATE_BODY_INSET)}>
      <div className="flex items-center gap-2">
        <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="stored-order min-w-0 truncate font-mono text-sm font-semibold text-foreground" dir="ltr">
          {visibleLine(toolName)}
        </span>
        {lines > 1 && (
          <span
            data-testid="chat-permission-command-lines"
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {lines} lines
          </span>
        )}
      </div>
      {command && (
        <p
          data-testid="chat-permission-command"
          dir="ltr"
          className="stored-order mt-1 font-mono text-xs leading-normal wrap-anywhere whitespace-pre-wrap text-foreground/80"
        >
          {visibleText(command)}
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
          dir="ltr"
          className="stored-order mt-2 max-h-60 animate-in overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground duration-150 fade-in-0 slide-in-from-top-1"
        >
          {visibleText(JSON.stringify(input, null, 2))}
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

function OptionsFooter({
  options,
  grants,
  onSelect,
}: {
  options: PermissionOption[];
  /** What "always" saves. */
  grants: readonly GrantLine[];
  onSelect: (option: PermissionOption) => void;
}) {
  return (
    // Stays in view while a long list scrolls behind it, unless the window is too short to spare
    // the room. `-bottom-1` reaches past the slot's own padding, so nothing shows under it.
    <div
      data-testid="chat-permission-options"
      className="flex flex-wrap items-center gap-2 bg-card px-4 pb-3 [@container_(min-height:26rem)]:sticky [@container_(min-height:26rem)]:-bottom-1 [@container_(min-height:26rem)]:pt-1"
    >
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
          {option.kind === 'allow_always' && <SavedBadge grants={grants} />}
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

/**
 * Everything "Always allow" saves, in full, before it is pressed. The list has
 * no scroller of its own: the gate's slot scrolls, down to the last line.
 */
function GrantList({ grants }: { grants: readonly GrantLine[] }) {
  if (grants.length === 0) return null;
  return (
    <div
      data-testid="chat-permission-grants"
      className={cn('pr-4 pb-2 text-xs text-muted-foreground', GATE_BODY_INSET)}
    >
      <span>{grants.length === 1 ? 'Always allow saves:' : `Always allow saves ${grants.length} changes:`}</span>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {grants.map(({ verb, subject, where }, index) => (
          <li key={index}>
            {verb}{' '}
            <code
              dir="ltr"
              className="stored-order rounded-sm bg-muted box-decoration-clone px-0.5 font-mono wrap-anywhere whitespace-pre-wrap text-foreground"
            >
              {subject}
            </code>{' '}
            {where}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What was suggested and is never saved from here, so nothing is dropped in silence. */
function OmittedList({ omitted, offersAlways }: { omitted: readonly string[]; offersAlways: boolean }) {
  if (omitted.length === 0) return null;
  return (
    <div
      data-testid="chat-permission-omitted"
      className={cn('pr-4 pb-2 text-xs text-muted-foreground', GATE_BODY_INSET)}
    >
      <span>
        {offersAlways
          ? 'Left out of Always allow, and not saved:'
          : 'Always allow is not offered. The agent’s suggestion is not saved from here:'}
      </span>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {omitted.map((line, index) => (
          <li key={index} dir="ltr" className="stored-order wrap-anywhere whitespace-pre-wrap">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The options as offered, minus an "always" whose every suggestion was dropped:
 * pressing it would save nothing. An adapter that suggests nothing (Codex) means
 * its own "always", and keeps it.
 */
function offeredOptions(options: PermissionOption[], saves: boolean, suggested: boolean): PermissionOption[] {
  return suggested && !saves ? options.filter((option) => option.kind !== 'allow_always') : options;
}

export function PermissionGate({ entry, reply, context }: PermissionGateProps) {
  const { request } = entry;
  const { name, details } = requestSummary(request.toolName, request.input);
  const { updates, omitted } = readSuggestions(request.suggestions);
  const grants = grantLines(updates);
  const options = offeredOptions(entry.options, grants.length > 0, updates.length + omitted.length > 0);
  const offersAlways = options.some((option) => option.kind === 'allow_always');

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
        {offersAlways && <GrantList grants={grants} />}
        <OmittedList omitted={omitted} offersAlways={offersAlways} />
        <OptionsFooter options={options} grants={grants} onSelect={onSelect} />
      </GateCardShell>
    </div>
  );
}
