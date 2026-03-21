import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspRegistry } from '../../lsp/lsp-registry.js';

describe('LspRegistry', () => {
  let registry: LspRegistry;

  beforeEach(() => {
    registry = new LspRegistry();
  });

  it('returns config for typescript', () => {
    const config = registry.getConfig('typescript');
    expect(config).toBeDefined();
    expect(config!.id).toBe('typescript');
    expect(config!.languages).toContain('.ts');
    expect(config!.languages).toContain('.tsx');
    expect(config!.languages).toContain('.js');
    expect(config!.languages).toContain('.jsx');
    expect(config!.bundled).toBe(true);
  });

  it('returns config for python', () => {
    const config = registry.getConfig('python');
    expect(config).toBeDefined();
    expect(config!.id).toBe('python');
    expect(config!.languages).toContain('.py');
    expect(config!.bundled).toBe(true);
  });

  it('returns config for java', () => {
    const config = registry.getConfig('java');
    expect(config).toBeDefined();
    expect(config!.id).toBe('java');
    expect(config!.languages).toContain('.java');
    expect(config!.bundled).toBe(false);
  });

  it('returns undefined for unknown language', () => {
    expect(registry.getConfig('rust')).toBeUndefined();
  });

  it('resolves language from file extension', () => {
    expect(registry.getLanguageForExtension('.ts')).toBe('typescript');
    expect(registry.getLanguageForExtension('.tsx')).toBe('typescript');
    expect(registry.getLanguageForExtension('.py')).toBe('python');
    expect(registry.getLanguageForExtension('.java')).toBe('java');
    expect(registry.getLanguageForExtension('.rs')).toBeNull();
  });

  it('lists all registered language IDs', () => {
    const ids = registry.getAllLanguageIds();
    expect(ids).toEqual(['typescript', 'python', 'java']);
  });

  describe('resolveCommand', () => {
    it('resolves bundled typescript server via createRequire', async () => {
      const result = await registry.resolveCommand('typescript');
      expect(result).not.toBeNull();
      expect(result!.command).toBe(process.execPath);
      expect(result!.args[0]).toContain('typescript-language-server');
    });

    it('resolves bundled pyright server', async () => {
      const result = await registry.resolveCommand('python');
      expect(result).not.toBeNull();
      expect(result!.command).toBe(process.execPath);
      expect(result!.args[0]).toContain('pyright');
    });

    it('returns null for unknown language', async () => {
      const result = await registry.resolveCommand('rust');
      expect(result).toBeNull();
    });
  });
});
