/**
 * synthesizeDraftChat — a Chat-shaped view of a new-thread draft.
 *
 * Before the first send a `__LOCALID_*` thread has no daemon chat, so the composer
 * toolbar has nothing to bind to. We project the in-memory draft into a `Chat` so
 * the existing controls (ProviderModelSelect / PermissionSelect /
 * PlanModeToggle / EffortPicker / FeaturesPopover) render unchanged — they read
 * only adapterId/model/permissionMode/planMode/effort + the feature flags. The
 * non-config fields are inert placeholders the controls never read.
 */
import type { Chat } from '@qlan-ro/mainframe-types';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

const EXEC_MODES = ['default', 'acceptEdits', 'yolo'] as const;

export function synthesizeDraftChat(id: string, d: DraftCfg): Chat {
  const permissionMode: Chat['permissionMode'] =
    d.permissionMode !== undefined && (EXEC_MODES as readonly string[]).includes(d.permissionMode)
      ? (d.permissionMode as Chat['permissionMode'])
      : d.permissionMode === 'plan'
        ? 'default'
        : undefined;
  return {
    id,
    adapterId: d.adapterId,
    projectId: d.projectId,
    model: d.model,
    permissionMode,
    planMode: d.planMode ?? d.permissionMode === 'plan',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    effort: d.effort ?? null,
    fast: d.fast ?? null,
    ultracode: d.ultracode ?? null,
    adaptiveThinking: d.adaptiveThinking ?? null,
    // A pre-send worktree attach — carried so the worktree trigger/panel and the
    // titlebar chip reflect the choice before the chat exists (todo #223).
    worktreePath: d.worktreePath,
    branchName: d.branchName,
    worktreeMissing: false,
  };
}
