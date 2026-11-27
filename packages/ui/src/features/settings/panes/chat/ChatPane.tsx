import { useUiPrefs, type EnterWhileRunning } from '@/store/ui-prefs';
import { PickerRow } from '../general/AppearanceControls';
import { ToggleRow } from '../shared/ToggleRow';

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
  const chips = useUiPrefs((s) => s.chipComposer);
  const setChips = useUiPrefs((s) => s.setChipComposer);
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
        <ToggleRow
          label="Mentions and commands as chips (preview)"
          description="A picked file, command or session becomes one chip. The caret steps over it and Backspace deletes it whole. The text sent to the agent does not change."
          checked={chips}
          onChange={setChips}
          testId="settings-chat-chip-composer"
        />
      </section>
    </div>
  );
}
