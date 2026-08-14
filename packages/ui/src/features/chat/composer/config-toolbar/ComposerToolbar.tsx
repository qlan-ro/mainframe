'use client';

/**
 * ComposerToolbar — the left-slot of the composer bottom bar.
 *
 * Calls useAdapters + useComposerTuning ONCE and fans out resolved props to
 * all config controls so no child runs its own hooks.
 *
 * Left→right order: Agent+Model · Permission · Plan · Worktree. Effort and
 * features are no longer their own chips — they live in each model row's
 * flyout inside the model menu (the Cursor pattern).
 * Renders nothing when every control is hidden (e.g. before chat/model loads).
 *
 * Wired into Composer.tsx via the `data-testid="chat-composer-toolbar"` slot.
 */

import { useAdapters, useComposerTuning } from './use-composer-tuning';
import { ProviderModelSelect } from './ProviderModelSelect';
import { PermissionSelect } from './PermissionSelect';
import { PlanModeToggle } from './PlanModeToggle';
import { WorktreePopover } from './WorktreePopover';
import { TuningWarningDialog } from './TuningWarningDialog';

export function ComposerToolbar() {
  const adapters = useAdapters();
  const {
    chat,
    adapter,
    model,
    providerDefaults,
    setModel,
    setModelTuning,
    setAdapter,
    setPermissionMode,
    setPlanMode,
    setEffort,
    setFeature,
    disabled,
    // The agent is locked once the thread has any messages — switching mid-thread
    // would orphan the CLI session (mirrors desktop's hasMessages guard).
    hasMessages,
    contextTokens,
    tuningWarning,
  } = useComposerTuning(adapters);

  // All controls need a resolved chat; nothing to render while loading.
  if (!chat) return null;

  return (
    <>
      <ProviderModelSelect
        chat={chat}
        adapters={adapters}
        adapter={adapter}
        model={model}
        locked={hasMessages}
        disabled={disabled}
        providerDefaults={providerDefaults}
        setAdapter={setAdapter}
        setModel={setModel}
        setModelTuning={setModelTuning}
        setEffort={setEffort}
        setFeature={setFeature}
      />
      <PermissionSelect
        chat={chat}
        adapter={adapter}
        setPermissionMode={setPermissionMode}
        providerDefaults={providerDefaults}
      />
      {adapter != null && <PlanModeToggle chat={chat} adapter={adapter} setPlanMode={setPlanMode} />}
      <WorktreePopover chat={chat} hasMessages={hasMessages} busy={disabled} />
      <TuningWarningDialog
        pending={tuningWarning.pending}
        contextTokens={contextTokens}
        suppressChecked={tuningWarning.suppressChecked}
        onSuppressChange={tuningWarning.setSuppressChecked}
        onConfirm={tuningWarning.confirm}
        onCancel={tuningWarning.cancel}
      />
    </>
  );
}
