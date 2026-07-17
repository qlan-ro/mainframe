/**
 * cm-setup.ts — createEditorCompartments exposes the reconfigurable slots
 * (including the `theme` slot the editor uses to hot-swap the dark flag on a
 * mode change). The live reconfigure behavior is covered by CmEditor.test.tsx
 * via the EditorView.darkTheme facet.
 */
import { describe, expect, it } from 'vitest';
import { Compartment } from '@codemirror/state';
import { createEditorCompartments } from '../cm-setup';

describe('createEditorCompartments', () => {
  it('exposes lang, readOnly, theme, and extra Compartments', () => {
    const c = createEditorCompartments();
    expect(c.lang).toBeInstanceOf(Compartment);
    expect(c.readOnly).toBeInstanceOf(Compartment);
    expect(c.theme).toBeInstanceOf(Compartment);
    expect(c.extra).toBeInstanceOf(Compartment);
  });
});
