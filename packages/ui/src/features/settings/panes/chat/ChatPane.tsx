import { useId, useState } from 'react';
import {
  HISTORY_TURNS_MAX,
  HISTORY_TURNS_MIN,
  clampHistoryTurns,
  useUiPrefs,
  type EnterWhileRunning,
} from '@/store/ui-prefs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

function HistoryTurnsRow() {
  const id = useId();
  const turns = useUiPrefs((s) => s.historyTurns);
  const setTurns = useUiPrefs((s) => s.setHistoryTurns);
  // What the field holds while it is being typed in; null shows the saved count.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) setTurns(clampHistoryTurns(draft.trim() === '' ? turns : Number(draft)));
    setDraft(null);
  };
  return (
    <div className="flex items-center justify-between gap-4 px-0.5 py-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm text-foreground">
          Turns to load at a time
        </Label>
        <p id={`${id}-description`} className="mt-0.5 text-xs text-muted-foreground">
          A chat opens on its last {turns} turns, and each older page adds as many. Whole turns only, from{' '}
          {HISTORY_TURNS_MIN} to {HISTORY_TURNS_MAX}. A change applies to the next chat you open or page you load.
        </p>
      </div>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={HISTORY_TURNS_MIN}
        max={HISTORY_TURNS_MAX}
        step={1}
        value={draft ?? String(turns)}
        aria-describedby={`${id}-description`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-20 flex-none"
        data-testid="settings-chat-history-turns"
      />
    </div>
  );
}

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
      <section className="mt-6 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
        <HistoryTurnsRow />
      </section>
    </div>
  );
}
