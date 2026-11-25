import { useRef, useState } from 'react';
import { ChevronRight, ShieldIcon, TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionOption } from '@qlan-ro/mainframe-types';
import { artifactPermissionInput, describeArtifactCall } from '@/features/chat/tools/cards/artifact-call';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead, GATE_BODY_INSET } from './shared/GateShell';
import { buildOptionResponse } from './build-control-response';
import { gateEyebrow, type GateContext, type ReplyFn } from './gate-types';
import { grantLines, readSuggestions, type GrantLine } from './permission-grants';
import { OptionsFooter } from './PermissionOptions';
import { useShownToEnd, type AllowedPart } from './use-shown-to-end';
import { visibleLine, visibleText } from './visible-text';

export type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Marks the block `useShownToEnd` measures; focusable so that the button that showed it can hand focus on. */
const allowedPart = (id: string) => ({ 'data-allowed-part': id, tabIndex: -1 });
const ALLOWED_PART = 'rounded-sm focus-visible:focus-line-inset';

/** The tool and its command are shown whole: the gate's slot scrolls them, and the count says how far they go. */
function ToolNameRow({ toolName, command }: { toolName: string; command?: string }) {
  const lines = command?.split('\n').length ?? 0;
  return (
    <div className={cn('px-4 pb-1', GATE_BODY_INSET)}>
      <div {...allowedPart('tool')} className={ALLOWED_PART}>
        <div className="flex items-start gap-2">
          <TerminalIcon className="mt-0.75 size-3.5 shrink-0 text-muted-foreground" />
          <span
            className="stored-order min-w-0 font-mono text-sm font-semibold wrap-anywhere text-foreground"
            dir="ltr"
          >
            {visibleLine(toolName)}
          </span>
          {lines > 1 && (
            <span
              data-testid="chat-permission-command-lines"
              className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums"
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
    </div>
  );
}

/** Whole when open, like the command: no scroller of its own. */
function DetailsDisclosure({ text, open, onToggle }: { text: string; open: boolean; onToggle: () => void }) {
  return (
    <div className={cn('px-4 pb-3', GATE_BODY_INSET)}>
      <button
        data-testid="chat-permission-details-toggle"
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-6 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        Details
      </button>
      {open && (
        // `bg-muted`, not the terminal palette: this is a JSON payload dump, the
        // same surface ToolFallback's args pre sits on — not terminal output.
        <pre
          {...allowedPart('details')}
          data-testid="chat-permission-details-pre"
          dir="ltr"
          className="stored-order mt-2 animate-in rounded-md bg-muted p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-foreground duration-150 fade-in-0 focus-visible:focus-line-inset"
        >
          {text}
        </pre>
      )}
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
      <div {...allowedPart('grants')} className={ALLOWED_PART}>
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

function allowedParts(
  name: string,
  command: string | undefined,
  details: string | undefined,
  grants: readonly GrantLine[],
) {
  // What is allowed, as far as it is on show: Details once they are open, the rules only when they can be saved.
  const parts: AllowedPart[] = [
    {
      id: 'tool',
      name: command ? 'the command' : 'the request',
      text: command ? `${visibleLine(name)}\n${visibleText(command)}` : visibleLine(name),
    },
  ];
  if (details !== undefined) parts.push({ id: 'details', name: 'the details', text: details });
  if (grants.length > 0) {
    parts.push({
      id: 'grants',
      name: 'what “Always allow” saves',
      text: grants.map(({ verb, subject, where }) => `${verb} ${subject} ${where}`).join('\n'),
    });
  }
  return parts;
}

export function PermissionGate({ entry, reply, context }: PermissionGateProps) {
  const { request } = entry;
  const { name, details } = requestSummary(request.toolName, request.input);
  const { updates, omitted } = readSuggestions(request.suggestions);
  const grants = grantLines(updates);
  const options = offeredOptions(entry.options, grants.length > 0, updates.length + omitted.length > 0);
  const offersAlways = options.some((option) => option.kind === 'allow_always');
  const command = commandOf(request.input);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsText = visibleText(JSON.stringify(details, null, 2));

  const gateRef = useRef<HTMLDivElement>(null);
  const parts = allowedParts(name, command, detailsOpen ? detailsText : undefined, offersAlways ? grants : []);
  const shown = useShownToEnd(gateRef, request.requestId, parts);

  // The clicked option's own id travels with the answer (spec decision 12 —
  // the daemon sees which offered option was actually selected, not a
  // client-synthesized stand-in), alongside the rich ControlResponse it maps to.
  const onSelect = (option: PermissionOption) => void reply(buildOptionResponse(entry, option), option.optionId);

  return (
    <div ref={gateRef} data-testid="chat-permission-gate">
      <GateCardShell accent="warning">
        <GateHead
          icon={<ShieldIcon className="size-3.5" />}
          tileClassName="bg-warning-surface text-warning"
          eyebrow={gateEyebrow('Permission required', context)}
          title={context?.title ?? 'Permission Required'}
        />
        <ToolNameRow toolName={name} command={command} />
        <DetailsDisclosure text={detailsText} open={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)} />
        {offersAlways && <GrantList grants={grants} />}
        <OmittedList omitted={omitted} offersAlways={offersAlways} />
        <OptionsFooter
          key={request.requestId}
          options={options}
          grants={grants}
          parts={parts}
          shown={shown}
          onSelect={onSelect}
        />
      </GateCardShell>
    </div>
  );
}
