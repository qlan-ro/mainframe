/**
 * The ⌘/ cheat sheet — a read-only rendering of the shortcut registry.
 *
 * It takes no per-shortcut props: a new entry in `registry.ts` appears here
 * with no change to this file. Open state lives in `cheat-sheet-store.ts`, so
 * the ⌘/ action can toggle it without reaching into the dialog.
 *
 * data-testid:
 *   shortcuts-cheat-sheet                 — the dialog content
 *   shortcuts-cheat-sheet-group-<group>   — one section per group
 *   shortcuts-cheat-sheet-row-<id>        — one row per shortcut, keyed by id
 */
import { useMemo } from 'react';
import { Keyboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionHeader } from '@/components/ui/section-header';
import type { ShortcutDescriptor, ShortcutGroup } from './shortcut-types';
import { SHORTCUTS, visibleShortcuts } from './registry';
import { renderEntryChord } from './render-chord';
import { isMacPlatform } from './platform';
import { useCheatSheetStore } from './cheat-sheet-store';
import { effectiveBindings, type EffectiveBinding } from './effective-bindings';
import { useKeybindingsStore } from './keybindings-store';

/** Display order; a group with no visible entry is skipped. */
const GROUP_ORDER: readonly ShortcutGroup[] = ['Sessions', 'Chat', 'Workspace', 'App'];

function ShortcutRow({ binding, isMac }: { binding: EffectiveBinding; isMac: boolean }) {
  const { entry, chord } = binding;
  return (
    <div
      data-testid={`shortcuts-cheat-sheet-row-${entry.id}`}
      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted"
    >
      <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span>
      {chord === null ? (
        // An unassigned action still earns a row: it is a thing you can bind,
        // and hiding it would make the cheat sheet disagree with Settings.
        <span className="shrink-0 text-xs text-muted-foreground">Unassigned</span>
      ) : (
        <kbd className="shrink-0 rounded border bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground">
          {renderEntryChord({ ...entry, chord }, isMac)}
        </kbd>
      )}
    </div>
  );
}

interface ShortcutsCheatSheetProps {
  /** The fixture seam: defaults to the shipped registry. */
  entries?: readonly ShortcutDescriptor[];
  /** Dev-only entries are hidden in production builds. */
  dev?: boolean;
}

export function ShortcutsCheatSheet({ entries = SHORTCUTS, dev = import.meta.env.DEV }: ShortcutsCheatSheetProps) {
  const open = useCheatSheetStore((s) => s.open);
  const setOpen = useCheatSheetStore((s) => s.setOpen);
  const isMac = isMacPlatform();

  const overrides = useKeybindingsStore((s) => s.overrides);

  const sections = useMemo(() => {
    const visible = visibleShortcuts(entries, { dev });
    const bindings = effectiveBindings(visible, overrides);
    return GROUP_ORDER.map((group) => ({
      group,
      rows: bindings.filter((binding) => binding.entry.group === group),
    })).filter(({ rows }) => rows.length > 0);
  }, [entries, dev, overrides]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-testid="shortcuts-cheat-sheet"
        aria-describedby={undefined}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-0 p-0"
        closeButtonClassName="top-1.5"
      >
        {/* pr-12 clears the stock close button. */}
        <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-1.5">
            <Keyboard size={13} className="shrink-0 text-primary" aria-hidden />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {sections.map(({ group, rows }) => (
            <section key={group} data-testid={`shortcuts-cheat-sheet-group-${group.toLowerCase()}`}>
              <SectionHeader>{group}</SectionHeader>
              {rows.map((binding) => (
                <ShortcutRow key={binding.entry.id} binding={binding} isMac={isMac} />
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
