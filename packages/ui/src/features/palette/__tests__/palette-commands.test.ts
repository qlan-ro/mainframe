import { describe, it, expect, vi } from 'vitest';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({
  emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a),
}));

const { getPaletteCommands, filterCommands } = await import('../palette-commands');

describe('palette-commands', () => {
  it('exposes the six artboard commands', () => {
    const ids = getPaletteCommands().map((c) => c.id);
    expect(ids).toEqual(['review', 'settings', 'sidebar', 'inspector', 'files', 'run']);
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
    byId.inspector!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-inspector' });
    byId.files!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'files' });
    byId.run!.run();
    expect(mockEmit).toHaveBeenCalledWith({ type: 'activate-surface', surface: 'run' });
  });

  it('filterCommands matches label case-insensitively', () => {
    const r = filterCommands(getPaletteCommands(), 'sett');
    expect(r.map((c) => c.id)).toEqual(['settings']);
    expect(filterCommands(getPaletteCommands(), '')).toHaveLength(6);
  });
});
