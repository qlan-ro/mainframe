import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../layout';

function getStore() {
  return useLayoutStore.getState();
}

describe('layout store', () => {
  beforeEach(() => {
    useLayoutStore.setState({ surfaces: { chat: true, files: false, run: false } });
  });

  it('default state has only chat active', () => {
    const { surfaces } = getStore();
    expect(surfaces.chat).toBe(true);
    expect(surfaces.files).toBe(false);
    expect(surfaces.run).toBe(false);
  });

  it('toggleSurface turns an inactive surface on', () => {
    getStore().toggleSurface('files');
    expect(getStore().surfaces.files).toBe(true);
  });

  it('toggleSurface turns an active surface off when others are on', () => {
    getStore().toggleSurface('files');
    getStore().toggleSurface('chat');
    expect(getStore().surfaces.chat).toBe(false);
    expect(getStore().surfaces.files).toBe(true);
  });

  it('floor invariant: cannot turn off the last active surface', () => {
    getStore().toggleSurface('chat'); // only chat is on → no-op
    expect(getStore().surfaces.chat).toBe(true);
  });

  it('floor invariant: can turn off one surface when two are active', () => {
    getStore().toggleSurface('run'); // chat=true, run=true
    getStore().toggleSurface('run'); // run=false
    expect(getStore().surfaces.run).toBe(false);
    expect(getStore().surfaces.chat).toBe(true);
  });
});
