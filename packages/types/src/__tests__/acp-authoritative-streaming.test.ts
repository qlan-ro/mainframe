import { describe, expect, it } from 'vitest';
import { MainframeCapabilitiesSchema } from '../acp/extensions.js';

describe('authoritative item streaming capability', () => {
  it.each([true, false])('preserves an explicit boolean %s', (value) => {
    expect(MainframeCapabilitiesSchema.parse({ authoritativeItemStreaming: value })).toEqual({
      authoritativeItemStreaming: value,
    });
  });

  it.each([undefined, null, 'true', 1, {}, []])('rejects invalid values except optional absence: %j', (value) => {
    const result = MainframeCapabilitiesSchema.safeParse({ authoritativeItemStreaming: value });
    expect(result.success).toBe(value === undefined);
  });

  it.each([{}, { replayComplete: true, itemCreationMarkers: true }])('does not infer support from %j', (value) => {
    const parsed = MainframeCapabilitiesSchema.parse(value);
    expect(parsed).toEqual(value);
    expect(parsed.authoritativeItemStreaming).toBeUndefined();
  });
});
