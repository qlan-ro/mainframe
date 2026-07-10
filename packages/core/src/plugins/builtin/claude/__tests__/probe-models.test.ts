import { describe, it, expect } from 'vitest';
import { extractProbePayload } from '../probe-models.js';

describe('extractProbePayload', () => {
  // Live-verified against CLI 2.1.198 (2026-07-04): `resolvedModel` is NOT a sibling of the
  // top-level `models` array as originally assumed — it's a per-entry field on each model,
  // e.g. `{ value: 'default', resolvedModel: 'claude-opus-4-8[1m]', ... }`. We only need the
  // "default" entry's resolvedModel, since that's the alias enrichWithContextWindow resolves.
  it("reads models and the 'default' entry's resolvedModel from the wrapped initialize response", () => {
    const event = {
      type: 'control_response',
      response: {
        response: {
          models: [{ value: 'default', displayName: 'Default', resolvedModel: 'claude-fable-5[1m]' }],
        },
      },
    };
    const out = extractProbePayload(event);
    expect(out?.models).toHaveLength(1);
    expect(out?.resolvedModel).toBe('claude-fable-5[1m]');
  });

  it('returns null when there is no models array', () => {
    expect(extractProbePayload({ type: 'control_response', response: { response: {} } })).toBeNull();
  });

  it('returns undefined resolvedModel when no entry is the default alias', () => {
    const event = {
      type: 'control_response',
      response: { response: { models: [{ value: 'claude-sonnet-5', displayName: 'Sonnet 5' }] } },
    };
    expect(extractProbePayload(event)?.resolvedModel).toBeUndefined();
  });

  it('carries each entry own resolvedModel onto the mapped model', () => {
    const event = {
      type: 'control_response',
      response: {
        response: {
          models: [
            { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' },
            { value: 'claude-sonnet-5', displayName: 'Sonnet 5' },
          ],
        },
      },
    };
    const out = extractProbePayload(event);
    expect(out?.models[0]?.resolvedModel).toBe('claude-sonnet-5');
    expect(out?.models[1]?.resolvedModel).toBeUndefined();
  });

  it('keeps the default alias and removes another entry resolving to the same model', () => {
    const event = {
      type: 'control_response',
      response: {
        response: {
          models: [
            {
              value: 'default',
              displayName: 'Default (recommended)',
              description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
              resolvedModel: 'claude-opus-4-8[1m]',
            },
            {
              value: 'opus[1m]',
              displayName: 'Opus',
              description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
              resolvedModel: 'claude-opus-4-8[1m]',
            },
            { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' },
          ],
        },
      },
    };

    const out = extractProbePayload(event);

    expect(out?.models.map((model) => model.id)).toEqual(['default', 'sonnet']);
    expect(out?.models[0]).toMatchObject({ label: 'Default - Opus 4.8', isDefault: true });
  });

  it('keeps entries with distinct or unresolved concrete models', () => {
    const event = {
      type: 'control_response',
      response: {
        response: {
          models: [
            { value: 'default', displayName: 'Default' },
            { value: 'opus[1m]', displayName: 'Opus', resolvedModel: 'claude-opus-4-8[1m]' },
            { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' },
          ],
        },
      },
    };

    expect(extractProbePayload(event)?.models.map((model) => model.id)).toEqual(['default', 'opus[1m]', 'sonnet']);
  });
});
