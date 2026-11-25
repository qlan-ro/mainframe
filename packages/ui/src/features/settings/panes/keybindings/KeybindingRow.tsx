/**
 * One shortcut in the Keybindings pane: its label, its current chord, and the
 * recorder that changes it.
 *
 * data-testid:
 *   settings-keybinding-row-<id>      — the row
 *   settings-keybinding-record-<id>   — the chord button / live recorder
 *   settings-keybinding-reset-<id>    — back to the registry default
 *   settings-keybinding-conflict-<id> — the holder warning + steal
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Chord, ShortcutDescriptor } from '@/features/shortcuts/shortcut-types';
import type { EffectiveBinding } from '@/features/shortcuts/effective-bindings';
import { chordFromEvent } from '@/features/shortcuts/chord-from-event';
import { renderEntryChord } from '@/features/shortcuts/render-chord';

interface KeybindingRowProps {
  binding: EffectiveBinding;
  isMac: boolean;
  onBind: (chord: Chord, confirmedHolderId: string | null) => ShortcutDescriptor | null;
  onReset: () => void;
}

export function KeybindingRow({ binding, isMac, onBind, onReset }: KeybindingRowProps) {
  const { entry, chord, isDefault, rebindable } = binding;
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<{ chord: Chord; holder: ShortcutDescriptor } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(event: KeyboardEvent) {
      // Every keystroke belongs to the recorder while it is armed, including
      // chords the app itself binds — otherwise ⌘F opens Find mid-recording.
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setRecording(false);
        setConflict(null);
        return;
      }
      const next = chordFromEvent(event, isMac);
      if (next == null) return;
      setRecording(false);
      const holder = onBind(next, null);
      setConflict(holder ? { chord: next, holder } : null);
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, isMac, onBind]);

  const label = chord === null ? 'Unassigned' : renderEntryChord({ ...entry, chord }, isMac);

  return (
    <div
      data-testid={`settings-keybinding-row-${entry.id}`}
      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted"
    >
      <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>

      {conflict && (
        <span
          data-testid={`settings-keybinding-conflict-${entry.id}`}
          className="shrink-0 text-xs text-muted-foreground"
        >
          Already {conflict.holder.label}
        </span>
      )}

      {conflict ? (
        <Button
          data-testid={`settings-keybinding-steal-${entry.id}`}
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs"
          onClick={() => {
            const holder = onBind(conflict.chord, conflict.holder.id);
            setConflict(holder ? { chord: conflict.chord, holder } : null);
          }}
        >
          Use it anyway
        </Button>
      ) : null}

      <Button
        ref={buttonRef}
        data-testid={`settings-keybinding-record-${entry.id}`}
        variant="ghost"
        size="sm"
        disabled={!rebindable}
        onClick={() => {
          setConflict(null);
          setRecording(true);
        }}
        className={cn(
          'shrink-0 rounded border bg-muted px-1 py-0.5 font-mono text-xs',
          recording ? 'text-accent-ink' : 'text-muted-foreground',
          !rebindable && 'opacity-60',
        )}
      >
        {recording ? 'Press a chord…' : label}
      </Button>

      <Button
        data-testid={`settings-keybinding-reset-${entry.id}`}
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs"
        disabled={isDefault}
        onClick={onReset}
      >
        Reset
      </Button>
    </div>
  );
}
