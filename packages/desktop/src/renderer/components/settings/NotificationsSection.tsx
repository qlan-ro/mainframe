import React, { useCallback } from 'react';
import type { NotificationConfig } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../store/settings';
import { updateGeneralSettings } from '../../lib/api';
import { Toggle } from '../ui/toggle';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:settings:notifications');

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-mf-small text-mf-text-primary">{label}</p>
        {description && <p className="text-mf-status text-mf-text-tertiary mt-0.5">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

interface GroupProps {
  title: string;
  children: React.ReactNode;
}

function Group({ title, children }: GroupProps): React.ReactElement {
  return (
    <div className="space-y-1">
      <h4 className="text-mf-small font-medium text-mf-text-secondary uppercase tracking-wide mb-2">{title}</h4>
      <div className="divide-y divide-mf-divider">{children}</div>
    </div>
  );
}

export function NotificationsSection(): React.ReactElement {
  const general = useSettingsStore((s) => s.general);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  const notifications = general.notifications;

  const applyPatch = useCallback(
    async (patch: Partial<NotificationConfig>) => {
      const merged: NotificationConfig = {
        chat: { ...notifications.chat, ...patch.chat },
        permission: { ...notifications.permission, ...patch.permission },
        other: { ...notifications.other, ...patch.other },
      };
      setNotifications(merged);
      try {
        await updateGeneralSettings({ notifications: patch });
      } catch (err) {
        log.warn('save notifications failed', { err: String(err) });
        setNotifications(notifications);
      }
    },
    [notifications, setNotifications],
  );

  const patchChat = useCallback(
    (key: keyof NotificationConfig['chat']) => (value: boolean) =>
      applyPatch({ chat: { ...notifications.chat, [key]: value } }),
    [applyPatch, notifications.chat],
  );

  const patchPermission = useCallback(
    (key: keyof NotificationConfig['permission']) => (value: boolean) =>
      applyPatch({ permission: { ...notifications.permission, [key]: value } }),
    [applyPatch, notifications.permission],
  );

  const patchOther = useCallback(
    (key: keyof NotificationConfig['other']) => (value: boolean) =>
      applyPatch({ other: { ...notifications.other, [key]: value } }),
    [applyPatch, notifications.other],
  );

  return (
    <div className="space-y-6">
      <h3 className="text-mf-heading font-semibold text-mf-text-primary">Notifications</h3>

      <Group title="Chat Notifications">
        <ToggleRow
          label="Task Complete"
          description="Notify when the assistant finishes a turn."
          checked={notifications.chat.taskComplete}
          onChange={patchChat('taskComplete')}
        />
        <ToggleRow
          label="Session Error"
          description="Notify when a run fails or errors out."
          checked={notifications.chat.sessionError}
          onChange={patchChat('sessionError')}
        />
      </Group>

      <Group title="Permission Request Notifications">
        <ToggleRow
          label="Tool Permission Requests"
          description="Notify when the CLI asks to run a tool."
          checked={notifications.permission.toolRequest}
          onChange={patchPermission('toolRequest')}
        />
        <ToggleRow
          label="User Question"
          description="Notify when the agent asks an interactive question."
          checked={notifications.permission.userQuestion}
          onChange={patchPermission('userQuestion')}
        />
        <ToggleRow
          label="Plan Approval"
          description="Notify when the agent presents a plan for approval."
          checked={notifications.permission.planApproval}
          onChange={patchPermission('planApproval')}
        />
      </Group>

      <Group title="Other">
        <ToggleRow
          label="Plugin Notifications"
          description="Notify for events from plugins (todos, PR detection, etc.)."
          checked={notifications.other.plugin}
          onChange={patchOther('plugin')}
        />
      </Group>
    </div>
  );
}
