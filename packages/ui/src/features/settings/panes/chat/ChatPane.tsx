import { useUiPrefs, type EnterWhileRunning } from '@/store/ui-prefs';
import { PickerRow } from '../general/AppearanceControls';

const ENTER_OPTIONS: { id: EnterWhileRunning; label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'steer', label: 'Steer' },
];

const ENTER_HELP: Record<EnterWhileRunning, string> = {
  queue: 'Enter sends when the agent finishes. ⌥↵ adds the message to the running turn instead.',
  steer: 'Enter adds the message to the running turn without stopping it. ⌥↵ sends it when the agent finishes instead.',
};

export function ChatPane() {
  const enter = useUiPrefs((s) => s.enterWhileRunning);
  const setEnter = useUiPrefs((s) => s.setEnterWhileRunning);
  return (
    <div data-testid="settings-pane-chat" className="flex flex-col">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Composer</h3>
        <PickerRow
          label="Enter while running"
          options={ENTER_OPTIONS}
          current={enter}
          prefix="settings-chat-enter-running"
          onSelect={setEnter}
        />
        <p className="text-xs text-muted-foreground">{ENTER_HELP[enter]}</p>
      </section>
    </div>
  );
}
