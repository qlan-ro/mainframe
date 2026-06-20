import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { subscribeToFileIntents } from '../intent-subscriber';
import { emitSurfaceIntent } from '../surface-intents';
import { useSettingsStore } from '../settings';
import { useLayoutStore } from '../layout';

describe('intent-subscriber — command intents', () => {
  let unsub: () => void;
  beforeEach(() => {
    unsub = subscribeToFileIntents();
  });
  afterEach(() => unsub());

  it('open-settings opens the settings store', () => {
    useSettingsStore.setState({ isOpen: false });
    emitSurfaceIntent({ type: 'open-settings' });
    expect(useSettingsStore.getState().isOpen).toBe(true);
  });

  it('toggle-sidebar flips sidebarVisible', () => {
    const before = useLayoutStore.getState().sidebarVisible;
    emitSurfaceIntent({ type: 'toggle-sidebar' });
    expect(useLayoutStore.getState().sidebarVisible).toBe(!before);
  });

  it('toggle-inspector flips inspectorVisible', () => {
    const before = useLayoutStore.getState().inspectorVisible;
    emitSurfaceIntent({ type: 'toggle-inspector' });
    expect(useLayoutStore.getState().inspectorVisible).toBe(!before);
  });
});
