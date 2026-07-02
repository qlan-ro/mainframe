import type { NotificationConfig } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { updateGeneralSettings, getGeneralSettings } from '../../../../lib/api/settings';
import { ToggleRow } from '../shared/ToggleRow';
import { SettingGroup } from '../shared/SettingGroup';

/** Deep-partial patch shape — mirrors the daemon's NotificationPatch. */
type NotificationPatch = {
  chat?: Partial<NotificationConfig['chat']>;
  permission?: Partial<NotificationConfig['permission']>;
  other?: Partial<NotificationConfig['other']>;
};

// Read latest from the store inside the handler so rapid toggles compose
// against the current UI state rather than a stale closure snapshot. The PUT
// body stays a leaf-only patch so concurrent writes from different groups
// remain commutative — full-object writes would let an older request
// overwrite a newer one's changes.
async function applyPatch(port: number, patch: NotificationPatch): Promise<void> {
  const current = useSettingsStore.getState().general.notifications;
  const merged: NotificationConfig = {
    chat: { ...current.chat, ...patch.chat },
    permission: { ...current.permission, ...patch.permission },
    other: { ...current.other, ...patch.other },
  };
  useSettingsStore.getState().setNotifications(merged);
  try {
    await updateGeneralSettings(port, { notifications: patch });
  } catch (err) {
    console.warn('[settings/NotificationsPane]', err);
    try {
      const fresh = await getGeneralSettings(port);
      useSettingsStore.getState().loadGeneral(fresh);
    } catch (refetchErr) {
      console.warn('[settings/NotificationsPane] resync failed', refetchErr);
    }
  }
}

export function NotificationsPane({ port }: { port: number }) {
  const notifications = useSettingsStore((s) => s.general.notifications);

  function patchChat(key: keyof NotificationConfig['chat'], value: boolean) {
    // Pass only the changed leaf; applyPatch merges against live store state.
    const leaf = { [key]: value } as Partial<NotificationConfig['chat']>;
    void applyPatch(port, { chat: leaf });
  }

  function patchPermission(key: keyof NotificationConfig['permission'], value: boolean) {
    const leaf = { [key]: value } as Partial<NotificationConfig['permission']>;
    void applyPatch(port, { permission: leaf });
  }

  function patchOther(key: keyof NotificationConfig['other'], value: boolean) {
    const leaf = { [key]: value } as Partial<NotificationConfig['other']>;
    void applyPatch(port, { other: leaf });
  }

  return (
    <div data-testid="settings-pane-notifications" className="flex flex-col gap-6 p-4">
      <h2 className="text-title font-bold text-foreground">Notifications</h2>

      <SettingGroup title="Chat">
        <ToggleRow
          label="Task Complete"
          description="Notify when a task finishes"
          checked={notifications.chat.taskComplete}
          onChange={(v) => patchChat('taskComplete', v)}
          testId="settings-notify-task-complete-toggle"
        />
        <ToggleRow
          label="Session Error"
          description="Notify when a session encounters an error"
          checked={notifications.chat.sessionError}
          onChange={(v) => patchChat('sessionError', v)}
          testId="settings-notify-session-error-toggle"
        />
      </SettingGroup>

      <SettingGroup title="Permissions">
        <ToggleRow
          label="Tool Request"
          description="Notify when the agent requests a tool permission"
          checked={notifications.permission.toolRequest}
          onChange={(v) => patchPermission('toolRequest', v)}
          testId="settings-notify-tool-request-toggle"
        />
        <ToggleRow
          label="User Question"
          description="Notify when the agent asks a question"
          checked={notifications.permission.userQuestion}
          onChange={(v) => patchPermission('userQuestion', v)}
          testId="settings-notify-user-question-toggle"
        />
        <ToggleRow
          label="Plan Approval"
          description="Notify when a plan requires approval"
          checked={notifications.permission.planApproval}
          onChange={(v) => patchPermission('planApproval', v)}
          testId="settings-notify-plan-approval-toggle"
        />
      </SettingGroup>

      <SettingGroup title="Other">
        <ToggleRow
          label="Plugin"
          description="Notify for plugin events"
          checked={notifications.other.plugin}
          onChange={(v) => patchOther('plugin', v)}
          testId="settings-notify-plugin-toggle"
        />
      </SettingGroup>
    </div>
  );
}
