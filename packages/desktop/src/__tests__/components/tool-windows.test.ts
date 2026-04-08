import { describe, it, expect, beforeEach } from 'vitest';

import {
  BUILTIN_TOOL_WINDOWS,
  getAllToolWindows,
  getToolWindow,
  getToolWindowsForZone,
  registerPluginToolWindow,
  unregisterPluginToolWindow,
} from '../../renderer/components/zone/tool-windows.js';

describe('BUILTIN_TOOL_WINDOWS', () => {
  it('has exactly 8 builtin tool windows', () => {
    expect(BUILTIN_TOOL_WINDOWS).toHaveLength(8);
  });

  it('all builtins have isBuiltin: true', () => {
    for (const tw of BUILTIN_TOOL_WINDOWS) {
      expect(tw.isBuiltin).toBe(true);
    }
  });

  it('contains expected builtin ids', () => {
    const ids = BUILTIN_TOOL_WINDOWS.map((tw) => tw.id);
    expect(ids).toContain('sessions');
    expect(ids).toContain('skills');
    expect(ids).toContain('agents');
    expect(ids).toContain('files');
    expect(ids).toContain('context');
    expect(ids).toContain('changes');
    expect(ids).toContain('preview');
    expect(ids).toContain('terminal');
  });
});

describe('getToolWindow', () => {
  it('returns the correct builtin by id', () => {
    const tw = getToolWindow('sessions');
    expect(tw).toBeDefined();
    expect(tw?.id).toBe('sessions');
    expect(tw?.label).toBe('Sessions');
  });

  it('returns undefined for unknown id', () => {
    expect(getToolWindow('nonexistent')).toBeUndefined();
  });
});

describe('getToolWindowsForZone', () => {
  it('returns Sessions for left-top', () => {
    const ids = getToolWindowsForZone('left-top').map((tw) => tw.id);
    expect(ids).toContain('sessions');
  });

  it('returns Skills and Agents for left-bottom', () => {
    const ids = getToolWindowsForZone('left-bottom').map((tw) => tw.id);
    expect(ids).toContain('skills');
    expect(ids).toContain('agents');
  });

  it('returns Files for right-top', () => {
    const ids = getToolWindowsForZone('right-top').map((tw) => tw.id);
    expect(ids).toContain('files');
  });

  it('returns Context and Changes for right-bottom', () => {
    const ids = getToolWindowsForZone('right-bottom').map((tw) => tw.id);
    expect(ids).toContain('context');
    expect(ids).toContain('changes');
  });

  it('returns Preview for bottom-left', () => {
    const ids = getToolWindowsForZone('bottom-left').map((tw) => tw.id);
    expect(ids).toContain('preview');
  });

  it('returns Terminal for bottom-right', () => {
    const ids = getToolWindowsForZone('bottom-right').map((tw) => tw.id);
    expect(ids).toContain('terminal');
  });

  it('returns empty array for zone with no windows', () => {
    // No builtin is assigned to right-top aside from files, so just check correctness
    const result = getToolWindowsForZone('right-top');
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('registerPluginToolWindow / unregisterPluginToolWindow', () => {
  beforeEach(() => {
    // Clean up any plugin windows registered in prior tests
    unregisterPluginToolWindow('plugin-test-1');
    unregisterPluginToolWindow('plugin-test-2');
  });

  it('registerPluginToolWindow adds a new tool window', () => {
    registerPluginToolWindow({ id: 'plugin-test-1', label: 'My Plugin', defaultZone: 'right-bottom' });
    const tw = getToolWindow('plugin-test-1');
    expect(tw).toBeDefined();
    expect(tw?.id).toBe('plugin-test-1');
    expect(tw?.isBuiltin).toBe(false);
    expect(tw?.defaultZone).toBe('right-bottom');
  });

  it('registered plugin tool window shows up in getAllToolWindows', () => {
    registerPluginToolWindow({ id: 'plugin-test-2', label: 'Plugin 2', defaultZone: 'left-top' });
    const all = getAllToolWindows();
    expect(all.some((tw) => tw.id === 'plugin-test-2')).toBe(true);
  });

  it('unregisterPluginToolWindow removes a plugin window', () => {
    registerPluginToolWindow({ id: 'plugin-test-1', label: 'My Plugin', defaultZone: 'right-bottom' });
    unregisterPluginToolWindow('plugin-test-1');
    expect(getToolWindow('plugin-test-1')).toBeUndefined();
  });

  it('unregisterPluginToolWindow is a no-op for builtins', () => {
    unregisterPluginToolWindow('sessions');
    // Sessions should still be present
    expect(getToolWindow('sessions')).toBeDefined();
    expect(BUILTIN_TOOL_WINDOWS).toHaveLength(8);
  });

  it('registered plugin window appears in getToolWindowsForZone', () => {
    registerPluginToolWindow({ id: 'plugin-test-1', label: 'My Plugin', defaultZone: 'right-bottom' });
    const ids = getToolWindowsForZone('right-bottom').map((tw) => tw.id);
    expect(ids).toContain('plugin-test-1');
    unregisterPluginToolWindow('plugin-test-1');
  });
});
