/**
 * cm-setup.ts — structural tests for makeWarmTheme and the editor compartments.
 *
 * We cannot introspect CM6's internal `dark` flag from a bare Extension, so
 * these tests verify the public contract: makeWarmTheme is exported, accepts a
 * boolean, and returns an Extension-shaped value; and createEditorCompartments
 * exposes the reconfigurable slots (including the new `theme` slot the editor
 * uses to hot-swap the dark flag on a mode change). The live reconfigure
 * behavior is covered by CmEditor.test.tsx via the EditorView.darkTheme facet.
 */
import { describe, expect, it } from 'vitest';
import { Compartment } from '@codemirror/state';
import { makeWarmTheme, createEditorCompartments } from '../cm-setup';

describe('makeWarmTheme', () => {
  it('is exported as a function', () => {
    expect(typeof makeWarmTheme).toBe('function');
  });

  it('returns a non-null value for isDark=false (light scheme)', () => {
    const theme = makeWarmTheme(false);
    expect(theme).toBeTruthy();
  });

  it('returns a non-null value for isDark=true (dark scheme)', () => {
    const theme = makeWarmTheme(true);
    expect(theme).toBeTruthy();
  });

  it('returns distinct Extension objects for different isDark values', () => {
    const light = makeWarmTheme(false);
    const dark = makeWarmTheme(true);
    // Each call produces a separate instance (not the same reference)
    expect(light).not.toBe(dark);
  });
});

describe('createEditorCompartments', () => {
  it('exposes lang, readOnly, theme, and extra Compartments', () => {
    const c = createEditorCompartments();
    expect(c.lang).toBeInstanceOf(Compartment);
    expect(c.readOnly).toBeInstanceOf(Compartment);
    expect(c.theme).toBeInstanceOf(Compartment);
    expect(c.extra).toBeInstanceOf(Compartment);
  });

  it('returns a fresh set each call (per-instance, never shared)', () => {
    const a = createEditorCompartments();
    const b = createEditorCompartments();
    expect(a.theme).not.toBe(b.theme);
  });
});
