import { useState } from 'react';
import { ChevronRight, ShieldIcon, TerminalIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { cn } from '@v2/lib/utils';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead, GATE_BODY_INSET } from './shared/GateShell';
import { buildPermissionResponse } from './build-control-response';
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

function ActionFooter({
  hasSuggestions,
  onDeny,
  onAllowOnce,
  onAlwaysAllow,
}: {
  hasSuggestions: boolean;
  onDeny: () => void;
  onAllowOnce: () => void;
  onAlwaysAllow: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <Button variant="destructive" size="sm" data-testid="chat-permission-deny" onClick={onDeny}>
        Deny
      </Button>
      <div className="flex-1" />
      <Button variant="outline" size="sm" data-testid="chat-permission-allow-once" onClick={onAllowOnce}>
        Allow once
      </Button>
      {hasSuggestions && (
        <Button size="sm" data-testid="chat-permission-always-allow" onClick={onAlwaysAllow}>
          Always allow
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PermissionGate
// ---------------------------------------------------------------------------

export interface PermissionGateProps {
  entry: ChatPermissionEntry;
  /** Called when the user denies / allows-once / always-allows. */
  reply: ReplyFn;
}

export function PermissionGate({ entry, reply }: PermissionGateProps) {
  const { request } = entry;

  const send = (kind: 'deny' | 'once' | 'always') => void reply(buildPermissionResponse(entry, kind));

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
        <ActionFooter
          hasSuggestions={request.suggestions.length > 0}
          onDeny={() => send('deny')}
          onAllowOnce={() => send('once')}
          onAlwaysAllow={() => send('always')}
        />
      </GateCardShell>
    </div>
  );
}
