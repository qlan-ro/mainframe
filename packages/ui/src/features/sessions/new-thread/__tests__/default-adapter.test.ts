/**
 * resolveDefaultAdapterId — pure resolution order:
 *   1. an explicit configured default, whatever it is
 *   2. else the first INSTALLED adapter (not merely the first in the list)
 *   3. else the 'claude' fallback
 */
import { describe, it, expect } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { resolveDefaultAdapterId } from '../default-adapter';

function adapter(id: string, installed: boolean): AdapterInfo {
  return { id, name: id, description: '', installed, models: [], capabilities: { planMode: false } };
}

describe('resolveDefaultAdapterId', () => {
  it('returns the explicit default when one is configured, even if adapters differ', () => {
    const adapters = [adapter('claude', true), adapter('gemini', true)];
    expect(resolveDefaultAdapterId('codex', adapters)).toBe('codex');
  });

  it('falls back to the first installed adapter when no default is configured', () => {
    const adapters = [adapter('codex', false), adapter('gemini', true), adapter('claude', true)];
    expect(resolveDefaultAdapterId(null, adapters)).toBe('gemini');
  });

  it('skips uninstalled adapters even if they appear first in the list', () => {
    const adapters = [adapter('codex', false), adapter('gemini', false), adapter('claude', true)];
    expect(resolveDefaultAdapterId(undefined, adapters)).toBe('claude');
  });

  it('falls back to "claude" when no default is configured and nothing is installed', () => {
    const adapters = [adapter('codex', false), adapter('gemini', false)];
    expect(resolveDefaultAdapterId(null, adapters)).toBe('claude');
  });

  it('falls back to "claude" when no default is configured and the adapter list is empty', () => {
    expect(resolveDefaultAdapterId(null, [])).toBe('claude');
  });
});
