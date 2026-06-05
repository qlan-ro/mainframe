'use client';

/**
 * ComposerToolbar — the left-slot of the composer bottom bar.
 *
 * Calls useAdapters + useComposerTuning ONCE and fans out resolved props to
 * EffortPicker + FeaturesPopover so neither child runs its own hooks.
 * Renders nothing visible when both controls are hidden (model with no
 * effort control and no tunable features).
 *
 * Wired into Composer.tsx via the `data-testid="chat-composer-toolbar"` slot.
 */

import { useAdapters, useComposerTuning } from './use-composer-tuning';
import { EffortPicker } from './EffortPicker';
import { FeaturesPopover } from './FeaturesPopover';

export function ComposerToolbar() {
  const adapters = useAdapters();
  const { chat, model, setEffort, setFeature, disabled } = useComposerTuning(adapters);

  // Both controls need a resolved chat + model; nothing to render while loading.
  if (!chat || !model) return null;

  return (
    <>
      <EffortPicker chat={chat} model={model} setEffort={setEffort} disabled={disabled} />
      <FeaturesPopover chat={chat} model={model} setFeature={setFeature} disabled={disabled} />
    </>
  );
}
