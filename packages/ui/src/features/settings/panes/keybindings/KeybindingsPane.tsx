/**
 * Settings → Keybindings. Rebinds the shortcut registry per machine.
 *
 * The registry stays the defaults; this pane only writes overrides, so a
 * shortcut added to `registry.ts` shows up here with no change to this file —
 * the same property the cheat sheet has.
 *
 * data-testid:
 *   settings-keybindings-pane
 *   settings-keybindings-group-<group>
 *   settings-keybindings-reset-all
 */
import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';
import { SHORTCUTS, visibleShortcuts } from '@/features/shortcuts/registry';
import type { Chord, ShortcutGroup } from '@/features/shortcuts/shortcut-types';
import { isMacPlatform } from '@/features/shortcuts/platform';
import { useKeybindingsStore } from '@/features/shortcuts/keybindings-store';
import { bindWithSteal, chordHolder, effectiveBindings } from '@/features/shortcuts/effective-bindings';
import { KeybindingRow } from './KeybindingRow';

const GROUP_ORDER: readonly ShortcutGroup[] = ['Sessions', 'Chat', 'Workspace', 'App'];

export function KeybindingsPane() {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const setOverrides = useKeybindingsStore((s) => s.setOverrides);
  const reset = useKeybindingsStore((s) => s.reset);
  const resetAll = useKeybindingsStore((s) => s.resetAll);
  const isMac = isMacPlatform();

  const visible = useMemo(() => visibleShortcuts(SHORTCUTS, { dev: import.meta.env.DEV }), []);
  const bindings = useMemo(() => effectiveBindings(visible, overrides), [visible, overrides]);
  const anyOverridden = bindings.some((binding) => !binding.isDefault);

  const holderFor = useCallback(
    (selfId: string) => (chord: Chord) => chordHolder(bindings, chord, isMac, selfId),
    [bindings, isMac],
  );

  const bind = useCallback(
    (id: string, chord: Chord, steal: boolean) => {
      // Both paths go through bindWithSteal: without a holder it is a plain
      // write, so there is one code path rather than two that can diverge.
      if (!steal && chordHolder(bindings, chord, isMac, id) != null) return;
      setOverrides(bindWithSteal(overrides, visible, id, chord, isMac));
    },
    [bindings, overrides, visible, isMac, setOverrides],
  );

  const sections = GROUP_ORDER.map((group) => ({
    group,
    rows: bindings.filter((binding) => binding.entry.group === group),
  })).filter(({ rows }) => rows.length > 0);

  return (
    <div data-testid="settings-keybindings-pane" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Shortcuts are stored on this Mac. Recording a chord another action holds offers to take it.
        </p>
        <Button
          data-testid="settings-keybindings-reset-all"
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs"
          disabled={!anyOverridden}
          onClick={resetAll}
        >
          Restore defaults
        </Button>
      </div>

      {sections.map(({ group, rows }) => (
        <section key={group} data-testid={`settings-keybindings-group-${group.toLowerCase()}`}>
          <SectionHeader>{group}</SectionHeader>
          {rows.map((binding) => (
            <KeybindingRow
              key={binding.entry.id}
              binding={binding}
              isMac={isMac}
              holderOf={holderFor(binding.entry.id)}
              onBind={(chord, steal) => bind(binding.entry.id, chord, steal)}
              onReset={() => reset(binding.entry.id)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
