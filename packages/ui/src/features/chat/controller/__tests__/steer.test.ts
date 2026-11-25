import { describe, it, expect } from 'vitest';
import { withSteer, wantsSteer } from '../steer';

describe('steer flag (C9)', () => {
  it('a message with no run config does not want to steer', () => {
    expect(wantsSteer({ runConfig: undefined })).toBe(false);
  });

  it('a message whose run config has other custom data does not want to steer', () => {
    expect(wantsSteer({ runConfig: { custom: { other: true } } })).toBe(false);
  });

  it('withSteer marks a run config so wantsSteer reads it', () => {
    expect(wantsSteer({ runConfig: withSteer(undefined) })).toBe(true);
  });

  it('withSteer keeps the run config’s other custom data', () => {
    expect(withSteer({ custom: { other: 'kept' } })).toEqual({ custom: { other: 'kept', mainframeSteer: true } });
  });

  it('withSteer does not change the run config it was given', () => {
    const original = { custom: { other: 1 } };

    withSteer(original);

    expect(original).toEqual({ custom: { other: 1 } });
  });

  it('only a literal true counts', () => {
    expect(wantsSteer({ runConfig: { custom: { mainframeSteer: 'yes' } } })).toBe(false);
  });
});
