import type { UpdateChannel } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../../../store/settings';
import { updateGeneralSettings } from '../../../../lib/api/settings';
import { IdleCompactionSettings } from './IdleCompactionSettings';
import { AppearanceControls, PickerRow } from './AppearanceControls';
import { WorktreeDirectorySettings } from './WorktreeDirectorySettings';

const UPDATE_CHANNEL_OPTIONS: { id: UpdateChannel; label: string }[] = [
  { id: 'stable', label: 'Stable' },
  { id: 'prerelease', label: 'Pre-release (RC)' },
];

export function GeneralPane({ port }: { port: number }) {
  const general = useSettingsStore((s) => s.general);
  const patchGeneral = useSettingsStore((s) => s.patchGeneral);

  function handleUpdateChannelSelect(updateChannel: UpdateChannel) {
    updateGeneralSettings(port, { updateChannel })
      .then(() => patchGeneral({ updateChannel }))
      .catch((err: unknown) => console.warn('[settings/GeneralPane]', err));
  }

  return (
    <div data-testid="settings-pane-general" className="flex flex-col">
      <section className="flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
        <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
        <AppearanceControls />
      </section>

      <WorktreeDirectorySettings port={port} />

      <IdleCompactionSettings port={port} />

      <section className="flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
        <h3 className="text-sm font-semibold text-foreground">Updates</h3>
        <PickerRow
          label="Channel"
          options={UPDATE_CHANNEL_OPTIONS}
          current={general.updateChannel}
          prefix="settings-updates-channel"
          onSelect={handleUpdateChannelSelect}
        />
      </section>
    </div>
  );
}
