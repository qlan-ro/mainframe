import { useState } from 'react';
import { ChevronRight, ShieldIcon, TerminalIcon } from 'lucide-react';
import type { ChatPermissionEntry } from '../controller/chat-thread-state';
import { GateCardShell, GateHead } from './shared/GateShell';
import { GateButton } from './shared/GateButton';
import { buildPermissionResponse } from './build-control-response';
import { cn } from '@/lib/utils';
import type { ReplyFn } from './gate-types';

export type { ReplyFn } from './gate-types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolNameRow({ toolName }: { toolName: string }) {
  return (
    <div className="flex items-center gap-2 px-3.5 pb-2 pl-[49px]">
      <TerminalIcon className="size-3.5 text-mf-text-3" />
      <span className="font-mono text-label font-semibold text-muted-foreground">{toolName}</span>
    </div>
  );
}

function DetailsDisclosure({ input }: { input: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-3.5 pb-3 pl-[49px]">
      <button
        data-testid="chat-permission-details-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('size-[11px] transition-transform', open && 'rotate-90')} />
        Details
      </button>
      {open && (
        <pre
          data-testid="chat-permission-details-pre"
          className="mt-2 max-h-60 animate-in fade-in-0 slide-in-from-top-1 duration-150 overflow-auto rounded-md bg-mf-term-bg p-3 font-mono text-caption text-mf-term-fg"
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
    <div className="flex items-center gap-2 px-3.5 pb-3">
      <GateButton kind="danger" data-testid="chat-permission-deny" onClick={onDeny}>
        Deny
      </GateButton>
      <div className="flex-1" />
      <GateButton kind="ghost" data-testid="chat-permission-allow-once" onClick={onAllowOnce}>
        Allow once
      </GateButton>
      {hasSuggestions && (
        <GateButton kind="primary" data-testid="chat-permission-always-allow" onClick={onAlwaysAllow}>
          Always allow
        </GateButton>
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
          icon={<ShieldIcon className="size-[15px]" />}
          tileClassName="bg-mf-warning-tint text-mf-warning"
          eyebrow="Permission required"
          eyebrowClassName="text-mf-warning"
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
