'use client';

/**
 * ComposerToolbar — the left-slot of the composer bottom bar.
 *
 * Calls useAdapters + useComposerTuning ONCE and fans out resolved props to
 * all config controls so no child runs its own hooks.
 *
 * Left→right order (matches artboard): Agent · Model · Permission · Plan · Effort · Features.
 * Renders nothing when every control is hidden (e.g. before chat/model loads).
 *
 * Wired into Composer.tsx via the `data-testid="chat-composer-toolbar"` slot.
 */

import { useAuiState } from '@assistant-ui/react';
import { useAdapters, useComposerTuning } from './use-composer-tuning';
import { ProviderModelSelect } from './ProviderModelSelect';
import { PermissionSelect } from './PermissionSelect';
import { PlanModeToggle } from './PlanModeToggle';
import { EffortPicker } from './EffortPicker';
import { FeaturesPopover } from './FeaturesPopover';

export function ComposerToolbar() {
  const adapters = useAdapters();
  const {
    chat,
    adapter,
    model,
    providerDefaults,
    setModel,
    setAdapter,
    setPermissionMode,
    setPlanMode,
    setEffort,
    setFeature,
    disabled,
  } = useComposerTuning(adapters);

  // The agent is locked once the thread has any messages — switching mid-thread
  // would orphan the CLI session (mirrors desktop's hasMessages guard).
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);

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
        setAdapter={setAdapter}
        setModel={setModel}
      />
      <PermissionSelect chat={chat} setPermissionMode={setPermissionMode} />
      {adapter != null && <PlanModeToggle chat={chat} adapter={adapter} setPlanMode={setPlanMode} />}
      {model && (
        <EffortPicker
          chat={chat}
          model={model}
          setEffort={setEffort}
          disabled={disabled}
          providerDefaults={providerDefaults}
        />
      )}
      {model && (
        <FeaturesPopover
          chat={chat}
          model={model}
          setFeature={setFeature}
          disabled={disabled}
          providerDefaults={providerDefaults}
        />
      )}
    </>
  );
}
