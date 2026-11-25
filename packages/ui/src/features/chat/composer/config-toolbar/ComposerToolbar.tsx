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
import { useUnattendedGuard } from './use-unattended-confirm';

const ANNOUNCE_MS = 1400;

export interface ComposerToolbarHandle {
  cyclePermission: () => void;
}

/** Holds a value for a moment. */
function useFlash<T>(ms: number): [T | null, (value: T) => void] {
  const [held, setHeld] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(
    (value: T) => {
      clearTimeout(timer.current);
      setHeld(value);
      timer.current = setTimeout(() => setHeld(null), ms);
    },
    [ms],
  );
  return [held, flash];
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
  const mode: ExecutionMode = chat ? currentPermission(chat, providerDefaults) : 'default';
  const unattended = useUnattendedGuard(chat?.id ?? null);
  const choosePermission = (next: ExecutionMode) => unattended.run(next, mode, () => setPermissionMode(next));
  const controls = useRef<HTMLDivElement>(null);
  /** The permissions control on screen: the chip stands in for it in a narrow composer. */
  const permissionsAnchor = () =>
    [...(controls.current?.querySelectorAll<HTMLElement>('[data-permissions-control]') ?? [])].find(
      (el) => el.offsetParent !== null,
    );
  const focusPermissions = () => permissionsAnchor()?.focus();
  const [announced, announce] = useFlash<ExecutionMode>(ANNOUNCE_MS);

  useImperativeHandle(
    ref,
    () => ({
      cyclePermission: () => {
        if (chat == null) return;
        const next = cyclePermission(mode);
        setPermissionMode(next);
        // The mode asked for: the chat still carries the old one until the daemon answers.
        announce(next);
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
    draftMode: tuning.draftMode,
    setEffort: tuning.setEffort,
    setFeature: tuning.setFeature,
    hideProviderSwitch: variant === 'side',
    switchBlockedReason: providerSwitchBlockedReason(chat, queuedCount, fromName),
    onSwitchProvider: tuning.switchProvider,
  };

  return (
    <div ref={controls} className="relative flex min-w-0 items-center gap-0.5">
      {/* Not a Radix tooltip: those take part in the menus' dismiss layers, and
          this one shows and hides on its own. */}
      <span
        role="status"
        aria-live="polite"
        data-testid="composer-permission-announcement"
        className={
          announced
            ? 'absolute bottom-full left-0 z-10 mb-1 rounded-[7px] bg-tooltip px-[9px] py-[5px] text-meta whitespace-nowrap text-tooltip-foreground shadow-tooltip'
            : 'sr-only'
        }
      >
        {announced &&
          `Permissions: ${permissionLabel(announced)}${chat.planMode ? ', after the plan' : ''} · ⇧⇥ to switch`}
      </span>
      <ProviderModelSelect
        {...menu}
        disabled={disabled}
        className="@max-[560px]/composer:max-w-[150px] @max-[400px]/composer:hidden"
      />
      <PermissionSelect
        chat={chat}
        adapter={adapter}
        setPermissionMode={choosePermission}
        providerDefaults={providerDefaults}
        className="@max-[400px]/composer:hidden"
      />
      <CombinedSelect
        {...menu}
        disabled={disabled}
        setPermissionMode={choosePermission}
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
      <UnattendedConfirmDialog confirm={unattended} returnFocus={focusPermissions} anchor={permissionsAnchor} />
    </div>
  );
}
