'use client';

/**
 * ComposerToolbar — the model and the permissions (C4), as two controls or,
 * below 400px, one chip (C6).
 *
 * Calls useAdapters + useComposerTuning ONCE and fans out resolved props, so
 * no child runs its own hooks. Renders nothing before the chat loads.
 *
 * `variant="side"` (todo #344): the side chat's adapter is a copy of the
 * parent's and locked, so its menu has no provider tabs.
 *
 * ⇧⇥ in the field reaches the permissions through `ref.cyclePermission`
 * (C12): it changes the mode, then shows and announces it for a moment.
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';
import { useChatExtras } from '../../runtime/chat-extras';
import { useAdapters, useComposerTuning } from './use-composer-tuning';
import { CombinedSelect } from './CombinedSelect';
import { cyclePermission, permissionLabel } from './permission-modes';
import { PermissionSelect, currentPermission } from './PermissionSelect';
import { ProviderModelSelect } from './ProviderModelSelect';
import { providerSwitchBlockedReason } from './provider-switch';
import { TuningWarningDialog } from './TuningWarningDialog';
import { UnattendedConfirmDialog } from './UnattendedConfirmDialog';
import { useProviderSwitch } from './use-provider-switch';
import { useUnattendedConfirm } from './use-unattended-confirm';

const ANNOUNCE_MS = 1400;

export interface ComposerToolbarHandle {
  cyclePermission: () => void;
}

/** True for a moment after `flash()`. */
function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}

export function ComposerToolbar({
  variant = 'main',
  ref,
}: {
  variant?: 'main' | 'side';
  ref?: Ref<ComposerToolbarHandle>;
}) {
  const adapters = useAdapters();
  const tuning = useComposerTuning(adapters);
  const { chat, adapter, model, runningModel, providerDefaults, setPermissionMode, disabled } = tuning;
  const extras = useChatExtras();
  const queuedCount = Object.values(extras?.queued ?? {}).filter((q) => q != null).length;
  const switchProvider = useProviderSwitch(chat, extras?.port ?? null);
  const mode: ExecutionMode = chat ? currentPermission(chat, providerDefaults) : 'default';
  const unattended = useUnattendedConfirm(chat?.id ?? null, mode, setPermissionMode);
  const [announced, announce] = useFlash(ANNOUNCE_MS);

  useImperativeHandle(
    ref,
    () => ({
      cyclePermission: () => {
        if (chat == null) return;
        setPermissionMode(cyclePermission(mode));
        announce();
      },
    }),
    [chat, mode, setPermissionMode, announce],
  );

  // All controls need a resolved chat; nothing to render while loading.
  if (!chat) return null;
  const fromName = adapters.find((a) => a.id === chat.adapterId)?.name ?? chat.adapterId;
  const menu = {
    chat,
    adapters,
    adapter,
    model,
    runningModel,
    showCurrentModel: chat.processState != null || disabled,
    locked: tuning.hasMessages,
    providerDefaults,
    setAdapter: tuning.setAdapter,
    setModel: tuning.setModel,
    setEffort: tuning.setEffort,
    setFeature: tuning.setFeature,
    hideProviderSwitch: variant === 'side',
    switchBlockedReason: providerSwitchBlockedReason(chat, queuedCount, fromName),
    onSwitchProvider: switchProvider,
  };

  return (
    <div className="relative flex min-w-0 items-center gap-0.5">
      {/* Not a Radix tooltip: those take part in the menus' dismiss layers, and
          this one shows and hides on its own. */}
      <span
        role="status"
        aria-live="polite"
        data-testid="composer-permission-announcement"
        className={
          announced
            ? 'absolute bottom-full left-0 z-10 mb-1 rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background'
            : 'sr-only'
        }
      >
        {announced && `Permissions: ${permissionLabel(mode)}${chat.planMode ? ', after the plan' : ''} · ⇧⇥ to switch`}
      </span>
      <ProviderModelSelect
        {...menu}
        disabled={disabled}
        className="@max-[560px]/composer:max-w-[150px] @max-[400px]/composer:hidden"
      />
      <PermissionSelect
        chat={chat}
        adapter={adapter}
        setPermissionMode={unattended.request}
        providerDefaults={providerDefaults}
        className="@max-[400px]/composer:hidden"
      />
      <CombinedSelect
        {...menu}
        disabled={disabled}
        setPermissionMode={unattended.request}
        className="@min-[400px]/composer:hidden"
      />
      <TuningWarningDialog
        pending={tuning.tuningWarning.pending}
        contextTokens={tuning.contextTokens}
        suppressChecked={tuning.tuningWarning.suppressChecked}
        onSuppressChange={tuning.tuningWarning.setSuppressChecked}
        onConfirm={tuning.tuningWarning.confirm}
        onCancel={tuning.tuningWarning.cancel}
      />
      <UnattendedConfirmDialog confirm={unattended} />
    </div>
  );
}
