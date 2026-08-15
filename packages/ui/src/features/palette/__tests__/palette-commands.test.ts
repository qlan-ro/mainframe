import { describe, it, expect, vi } from 'vitest';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a),
}));

// The hints render off the live platform; pin macOS so the glyph assertions
// below read ⌘ rather than the node runner's Ctrl.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

const { getPaletteCommands, filterCommands } = await import('../palette-commands');
const { useCheatSheetStore } = await import('@/features/shortcuts/cheat-sheet-store');

describe('palette-commands', () => {
  it('exposes one command per surface plus the overlay commands', () => {
    const ids = getPaletteCommands().map((c) => c.id);
    expect(ids).toEqual(['review', 'settings', 'sidebar', 'files', 'workspace', 'keyboard-shortcuts']);
  });

  it('each command emits the right intent on run()', () => {
    const byId = Object.fromEntries(getPaletteCommands().map((c) => [c.id, c]));
    mockEmit.mockClear();
    byId.review!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-review' });
    byId.settings!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-settings' });
    byId.sidebar!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-sidebar' });
    byId.files!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-workspace-files' });
    byId.workspace!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'workspace' });
  });

  it('opens the cheat sheet from the Keyboard Shortcuts command', () => {
    const cmd = getPaletteCommands().find((c) => c.id === 'keyboard-shortcuts');
    expect(cmd?.label).toBe('Keyboard Shortcuts');
    useCheatSheetStore.getState().setOpen(false);
    cmd!.run();
    expect(useCheatSheetStore.getState().open).toBe(true);
    useCheatSheetStore.getState().setOpen(false);
  });

  it('reads every hint off the shortcut registry', () => {
    const byId = Object.fromEntries(getPaletteCommands().map((c) => [c.id, c]));
    expect(byId.review!.hint).toBe('⌘⇧R');
    expect(byId.settings!.hint).toBe('⌘,');
    // Was hardcoded as ⌘\ while the shipped chord is ⌘B — the drift this fixes.
    expect(byId.sidebar!.hint).toBe('⌘B');
    expect(byId['keyboard-shortcuts']!.hint).toBe('⌘/');
  });

  it('filterCommands matches label case-insensitively', () => {
    const r = filterCommands(getPaletteCommands(), 'sett');
    expect(r.map((c) => c.id)).toEqual(['settings']);
    expect(filterCommands(getPaletteCommands(), '')).toHaveLength(6);
  });
});
