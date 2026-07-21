import { describe, expect, it } from 'vitest';
import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';
import { resolveDraftDefaults } from '../resolve-draft-defaults';

function makeAdapter(models: AdapterModel[]): AdapterInfo {
  return {
    id: 'claude',
    name: 'Claude',
    description: 'Claude Code',
    installed: true,
    models,
    capabilities: { planMode: true },
  };
}

const opus: AdapterModel = {
  id: 'opus',
  label: 'Opus',
  supportedEfforts: ['low', 'high', 'xhigh'],
  defaultEffort: 'low',
  supportsFast: true,
  supportsUltracode: true,
  supportsAdaptiveThinking: true,
};

describe('resolveDraftDefaults', () => {
  it('resolves every configured provider default', () => {
    const adapter = makeAdapter([opus]);

    expect(
      resolveDraftDefaults('p1', adapter, {
        defaultModel: 'opus',
        defaultMode: 'yolo',
        defaultPlanMode: 'true',
        defaultEffort: 'high',
        defaultFast: 'true',
        defaultUltracode: 'false',
        defaultAdaptiveThinking: 'true',
      }),
    ).toEqual({
      projectId: 'p1',
      adapterId: 'claude',
      model: 'opus',
      permissionMode: 'yolo',
      planMode: true,
      effort: 'high',
      fast: true,
      ultracode: false,
      adaptiveThinking: true,
    });
  });

  it('falls back from a stale configured model to the catalog default', () => {
    const adapter = makeAdapter([
      { ...opus, isDefault: true },
      { id: 'sonnet', label: 'Sonnet' },
    ]);

    expect(resolveDraftDefaults('p1', adapter, { defaultModel: 'stale' }).model).toBe('opus');
  });

  it('uses the catalog default when no model is configured', () => {
    const adapter = makeAdapter([
      { id: 'sonnet', label: 'Sonnet' },
      { ...opus, isDefault: true },
    ]);

    expect(resolveDraftDefaults('p1', adapter).model).toBe('opus');
  });

  it('uses the first model when there is no configured or catalog default', () => {
    const adapter = makeAdapter([{ id: 'sonnet', label: 'Sonnet' }, opus]);

    expect(resolveDraftDefaults('p1', adapter).model).toBe('sonnet');
  });

  it('returns explicit defaults when provider settings are absent', () => {
    const adapter = makeAdapter([opus]);

    expect(resolveDraftDefaults('p1', adapter)).toEqual({
      projectId: 'p1',
      adapterId: 'claude',
      model: 'opus',
      permissionMode: 'default',
      planMode: false,
      effort: 'low',
      fast: false,
      ultracode: false,
      adaptiveThinking: false,
    });
  });

  it('forces configured features off when the model does not support them', () => {
    const adapter = makeAdapter([
      {
        id: 'sonnet',
        label: 'Sonnet',
        supportedEfforts: ['medium'],
        supportsFast: false,
        supportsUltracode: false,
        supportsAdaptiveThinking: false,
      },
    ]);

    expect(
      resolveDraftDefaults('p1', adapter, {
        defaultFast: 'true',
        defaultUltracode: 'true',
        defaultAdaptiveThinking: 'true',
      }),
    ).toMatchObject({ fast: false, ultracode: false, adaptiveThinking: false });
  });

  it('clamps configured effort to the selected model', () => {
    const adapter = makeAdapter([opus]);

    expect(resolveDraftDefaults('p1', adapter, { defaultEffort: 'max' }).effort).toBe('low');
  });

  it('forces effort to xhigh when supported ultracode is enabled', () => {
    const adapter = makeAdapter([opus]);

    expect(
      resolveDraftDefaults('p1', adapter, {
        defaultEffort: 'low',
        defaultUltracode: 'true',
      }),
    ).toMatchObject({ effort: 'xhigh', ultracode: true });
  });

  it('throws when the adapter catalog is empty', () => {
    expect(() => resolveDraftDefaults('p1', makeAdapter([]))).toThrow('Cannot initialize draft: adapter has no models');
  });
});
