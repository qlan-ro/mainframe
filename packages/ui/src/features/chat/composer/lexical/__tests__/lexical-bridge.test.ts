import { describe, expect, it, vi } from 'vitest';
import { createLexicalComposerBridge } from '../lexical-bridge';

const REQUEST = { char: '@', item: { id: 'a.ts', type: 'file', label: 'a.ts' }, directive: '@a.ts', appendSpace: true };

describe('createLexicalComposerBridge', () => {
  it('reports no insertion while no field is attached', () => {
    expect(createLexicalComposerBridge().insertPick(REQUEST)).toBe(false);
  });

  it('routes picks and the mention button to the attached field', () => {
    const bridge = createLexicalComposerBridge();
    const field = { insertPick: vi.fn(() => true), openMention: vi.fn() };
    bridge.attach(field);

    expect(bridge.insertPick(REQUEST)).toBe(true);
    bridge.openMention();

    expect(field.insertPick).toHaveBeenCalledWith(REQUEST);
    expect(field.openMention).toHaveBeenCalledTimes(1);
  });

  it('a stale detach leaves the newer field attached', () => {
    const bridge = createLexicalComposerBridge();
    const detachOld = bridge.attach({ insertPick: () => false, openMention: () => {} });
    bridge.attach({ insertPick: () => true, openMention: () => {} });

    detachOld();

    expect(bridge.insertPick(REQUEST)).toBe(true);
  });

  it('notifies subscribers only when the masked text changes', () => {
    const bridge = createLexicalComposerBridge();
    const listener = vi.fn();
    bridge.subscribe(listener);

    bridge.setMaskedText('see       ');
    bridge.setMaskedText('see       ');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(bridge.getMaskedText()).toBe('see       ');
  });
});
