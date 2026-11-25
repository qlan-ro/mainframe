import { useUiPrefs, type LinkTarget } from '@/store/ui-prefs';
import { PickerRow } from './AppearanceControls';

const TARGETS: { id: LinkTarget; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'browser', label: 'Browser' },
];

/** Where a URL in a reply opens (T1d). */
export function LinkSettings() {
  const openLinksIn = useUiPrefs((s) => s.openLinksIn);
  const setOpenLinksIn = useUiPrefs((s) => s.setOpenLinksIn);
  return (
    <section className="flex flex-col gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">Links</h3>
      <PickerRow
        label="Open links in"
        options={TARGETS}
        current={openLinksIn}
        prefix="settings-links-open-in"
        onSelect={setOpenLinksIn}
      />
    </section>
  );
}
