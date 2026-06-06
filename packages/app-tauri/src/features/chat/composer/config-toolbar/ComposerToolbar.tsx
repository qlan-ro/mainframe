'use client';

/**
 * ComposerToolbar — the left-slot of the composer bottom bar.
 *
 * Calls useAdapters + useComposerTuning ONCE and fans out resolved props to
 * all config controls so no child runs its own hooks.
 *
 * Left→right order (matches artboard): Model · Permission · Plan · Effort · Features.
 * Renders nothing when every control is hidden (e.g. before chat/model loads).
 *
 * Wired into Composer.tsx via the `data-testid="chat-composer-toolbar"` slot.
 */

import { useAdapters, useComposerTuning } from './use-composer-tuning';
import { ModelSelect } from './ModelSelect';
import { PermissionSelect } from './PermissionSelect';
import { PlanModeToggle } from './PlanModeToggle';
import { EffortPicker } from './EffortPicker';
import { FeaturesPopover } from './FeaturesPopover';

export function ComposerToolbar() {
  const adapters = useAdapters();
  const { chat, adapter, model, setModel, setPermissionMode, setPlanMode, setEffort, setFeature, disabled } =
    useComposerTuning(adapters);

  // All controls need a resolved chat; nothing to render while loading.
  if (!chat) return null;

  return (
    <>
      {adapter != null && <ModelSelect chat={chat} adapter={adapter} model={model} setModel={setModel} />}
      <PermissionSelect chat={chat} setPermissionMode={setPermissionMode} />
      {adapter != null && <PlanModeToggle chat={chat} adapter={adapter} setPlanMode={setPlanMode} />}
      {model && <EffortPicker chat={chat} model={model} setEffort={setEffort} disabled={disabled} />}
      {model && <FeaturesPopover chat={chat} model={model} setFeature={setFeature} disabled={disabled} />}
    </>
  );
}
