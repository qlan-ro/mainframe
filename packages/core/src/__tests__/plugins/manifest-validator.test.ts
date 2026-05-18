import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../plugins/security/manifest-validator.js';

describe('validateManifest', () => {
  it('accepts valid manifest', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['storage', 'ui:panels'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid id (uppercase)', () => {
    const result = validateManifest({ id: 'MyPlugin', name: 'x', version: '1', capabilities: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('id');
    }
  });

  it('rejects unknown capability', () => {
    const result = validateManifest({ id: 'x', name: 'x', version: '1', capabilities: ['malware'] });
    expect(result.success).toBe(false);
  });

  it('requires adapter field when adapters capability is declared', () => {
    const result = validateManifest({ id: 'x', name: 'x', version: '1', capabilities: ['adapters'] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('adapter');
    }
  });

  it('accepts adapters capability when adapter field is present', () => {
    const result = validateManifest({
      id: 'gemini',
      name: 'Gemini',
      version: '1.0.0',
      capabilities: ['adapters'],
      adapter: { binaryName: 'gemini', displayName: 'Gemini CLI' },
    });
    expect(result.success).toBe(true);
  });

  // ─── Single-object ui (legacy shape) ──────────────────────────────────────

  it('accepts legacy single-object ui field with a valid zone', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: { zone: 'left-panel', label: 'Todos', icon: 'CheckSquare' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts legacy single-object ui with a ZoneId zone', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: { zone: 'right-top', label: 'Sidebar' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects ui field with an invalid zone', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: { zone: 'sidebar-primary', label: 'Todos' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects manifest with ui.zone but without ui:panels capability', () => {
    const result = validateManifest({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      capabilities: [],
      ui: { zone: 'fullview', label: 'Test' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/ui:panels/);
    }
  });

  // ─── Array ui (new multi-zone shape) ──────────────────────────────────────

  it('accepts new array ui field with multiple zone contributions', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: [
        { zone: 'fullview', label: 'Kanban', icon: 'square-check' },
        { zone: 'right-top', label: 'Quick Add', icon: 'list-todo' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects array ui where any contribution has an invalid zone', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: [
        { zone: 'fullview', label: 'Kanban' },
        { zone: 'not-a-real-zone', label: 'Bad' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects array ui when ui:panels capability is missing', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: [],
      ui: [{ zone: 'fullview', label: 'Kanban' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/ui:panels/);
    }
  });

  it('accepts empty array ui without requiring ui:panels', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: [],
      ui: [],
    });
    expect(result.success).toBe(true);
  });
});
