import { ShieldIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PermissionOption, PermissionOptionKind, RequestPermissionRequest } from '@qlan-ro/mainframe-types';
import { GateCardShell, GateHead, GATE_BODY_INSET } from './shared/GateShell';
import { buildAcpSelection } from './build-acp-permission-response';
import type { AcpReplyFn } from './gate-types';

export type { AcpReplyFn } from './gate-types';

/**
 * `kind` styles the button ONLY — the reply is `{outcome:'selected',
 * optionId}` for whichever option is clicked, regardless of its `kind` or
 * `name` (spec: "clients must not infer a permission's effect from option
 * kind or label" — `permission.ts`'s `PermissionOptionSchema` doc comment).
 * Every enum member maps to exactly one variant so an unfamiliar adapter's
 * options still render consistently.
 */
const KIND_VARIANT: Record<PermissionOptionKind, 'outline' | 'default' | 'destructive'> = {
  allow_once: 'outline',
  allow_always: 'default',
  reject_once: 'destructive',
  reject_always: 'destructive',
};

function OptionButton({ option, onSelect }: { option: PermissionOption; onSelect: (optionId: string) => void }) {
  return (
    <Button
      variant={KIND_VARIANT[option.kind]}
      size="sm"
      data-testid={`chat-acp-permission-option-${option.optionId}`}
      onClick={() => onSelect(option.optionId)}
    >
      {option.name}
    </Button>
  );
}

export interface AcpPermissionGateProps {
  request: RequestPermissionRequest;
  /** Called with the plain `{outcome:'selected', optionId}` answer for the clicked option. */
  reply: AcpReplyFn;
}

/**
 * Generic option-list gate for `session/request_permission` (todo #350, plan
 * task 22). Renders the adapter-supplied `options` verbatim, in the order
 * the adapter sent them — no fixed deny/allow-once/always-allow button set
 * like the legacy `PermissionGate`, since ACP options are adapter-defined
 * and the client can't assume there are exactly three.
 */
export function AcpPermissionGate({ request, reply }: AcpPermissionGateProps) {
  const toolName = request.subject?.type === 'tool_call' ? (request.subject.toolCall.title ?? undefined) : undefined;
  const handleSelect = (optionId: string) => void reply(buildAcpSelection(optionId));

  return (
    <div data-testid="chat-acp-permission-gate">
      <GateCardShell accent="warning">
        <GateHead
          icon={<ShieldIcon className="size-3.5" />}
          tileClassName="bg-warning/10 text-warning"
          eyebrow="Permission required"
          title={request.title}
          subtitle={toolName}
        />
        {request.description && (
          <p
            data-testid="chat-acp-permission-description"
            className={cn('px-4 pb-2 text-sm text-foreground', GATE_BODY_INSET)}
          >
            {request.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {request.options.map((option) => (
            <OptionButton key={option.optionId} option={option} onSelect={handleSelect} />
          ))}
        </div>
      </GateCardShell>
    </div>
  );
}
