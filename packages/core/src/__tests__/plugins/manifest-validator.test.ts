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

  it('accepts valid ui field with a UIZone', () => {
    const result = validateManifest({
      id: 'todos',
      name: 'Todos',
      version: '1.0.0',
      capabilities: ['ui:panels'],
      ui: { zone: 'left-panel', label: 'Todos', icon: 'CheckSquare' },
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
});
