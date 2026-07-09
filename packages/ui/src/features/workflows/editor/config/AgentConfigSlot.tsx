/**
 * AgentConfigSlot — the `agent` step's custom config slot.
 *
 * Reuses the composer's ProviderModelSelect + PermissionSelect against a
 * synthesized draft Chat (see synthesizeDraftChat) so the same pickers drive
 * a workflow step that has no real chat behind it. The composer components
 * stay chat-agnostic — this file is the only place that knows a workflow
 * step exists.
 *
 * v1 has NO worktree control (Resolution 1 in the plan): `step.agent.worktree`
 * is never shown or cleared. Every patch spreads `...agent` first so an
 * existing worktree value survives edits to any other field.
 */
import type { PermissionMode } from '@qlan-ro/mainframe-types';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ProviderModelSelect } from '@/features/chat/composer/config-toolbar/ProviderModelSelect';
import { PermissionSelect } from '@/features/chat/composer/config-toolbar/PermissionSelect';
import { synthesizeDraftChat } from '@/features/chat/composer/config-toolbar/synthesize-draft-chat';
import { useAdapters } from '@/store/adapters';
import type { WfCustomSlotProps } from './descriptor-types';

const PERMISSION_MODES = ['default', 'acceptEdits', 'yolo', 'plan'] as const;

function toPermissionMode(raw: string | undefined): PermissionMode | undefined {
  return raw !== undefined && (PERMISSION_MODES as readonly string[]).includes(raw)
    ? (raw as PermissionMode)
    : undefined;
}

function FieldShell({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block space-y-1.5">
      <span className="text-label font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function parseTimeout(raw: string): number | undefined {
  if (raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function AgentConfigSlot({ step, onPatch }: WfCustomSlotProps): React.ReactElement | null {
  const adapters = useAdapters();
  if (step.kind !== 'agent') return null;
  const agent = step.agent;

  const adapter = adapters.find((a) => a.id === agent.adapterId) ?? null;
  const model = adapter?.models.find((m) => m.id === agent.model) ?? null;

  const chat = synthesizeDraftChat('__wf_agent__', {
    projectId: agent.projectId ?? '',
    adapterId: agent.adapterId ?? '',
    model: agent.model,
    permissionMode: toPermissionMode(agent.permissionMode),
  });

  return (
    <div className="space-y-[10px]">
      <div className="flex items-center gap-[6px]">
        <div data-testid={`workflows-config-${step.id}-adapter`}>
          <div data-testid={`workflows-config-${step.id}-model`}>
            <ProviderModelSelect
              chat={chat}
              adapters={adapters}
              adapter={adapter}
              model={model}
              locked={false}
              setAdapter={(adapterId) => onPatch({ agent: { ...agent, adapterId } })}
              setModel={(nextModel) => onPatch({ agent: { ...agent, model: nextModel } })}
            />
          </div>
        </div>
        <div data-testid={`workflows-config-${step.id}-permission`}>
          <PermissionSelect
            chat={chat}
            setPermissionMode={(permissionMode) => onPatch({ agent: { ...agent, permissionMode } })}
          />
        </div>
      </div>

      <FieldShell label="Prompt">
        <Textarea
          data-testid={`workflows-config-${step.id}-prompt`}
          value={agent.prompt}
          onChange={(e) => onPatch({ agent: { ...agent, prompt: e.target.value } })}
        />
      </FieldShell>

      <FieldShell label="Timeout (minutes)">
        <Input
          type="number"
          data-testid={`workflows-config-${step.id}-timeout`}
          value={typeof agent.timeoutMinutes === 'number' ? agent.timeoutMinutes : ''}
          onChange={(e) => onPatch({ agent: { ...agent, timeoutMinutes: parseTimeout(e.target.value) } })}
        />
      </FieldShell>
    </div>
  );
}
