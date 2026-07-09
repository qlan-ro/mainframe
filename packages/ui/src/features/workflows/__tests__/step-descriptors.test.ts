import { describe, it, expect } from 'vitest';
import { descriptorsFor } from '@/features/workflows/editor/config/step-descriptors';
import type { WfStepKind } from '@/features/workflows/editor/wf-draft-types';

const ALL_KINDS: WfStepKind[] = ['agent', 'form', 'service', 'choose', 'foreach', 'parallel', 'call', 'set'];

describe('descriptorsFor', () => {
  it('foreach has an expr over field and a plain as field', () => {
    const descs = descriptorsFor('foreach');
    expect(descs.find((d) => d.key === 'over')).toMatchObject({ kind: 'text', expr: true });
    expect(descs.find((d) => d.key === 'as')).toMatchObject({ kind: 'text' });
  });

  it('every kind ends with the shared Advanced descriptors', () => {
    for (const kind of ALL_KINDS) {
      const descs = descriptorsFor(kind);
      const tail = descs.slice(-3);
      expect(tail[0]).toMatchObject({ key: 'retry.attempts' });
      expect(tail[1]).toMatchObject({ kind: 'select', key: 'onFailure' });
      expect(tail[2]).toMatchObject({ kind: 'text', key: 'output', expr: true });
    }
  });

  it('agent is a single custom slot plus the Advanced descriptors', () => {
    const descs = descriptorsFor('agent');
    expect(descs).toHaveLength(4);
    expect(descs[0]).toMatchObject({ kind: 'custom', key: 'agent' });
  });

  it('choose is a single custom arms-editor slot plus the Advanced descriptors', () => {
    const descs = descriptorsFor('choose');
    expect(descs).toHaveLength(4);
    expect(descs[0]).toMatchObject({ kind: 'custom', key: 'arms' });
  });

  it('parallel is a single custom branches-editor slot plus the Advanced descriptors', () => {
    const descs = descriptorsFor('parallel');
    expect(descs).toHaveLength(4);
    expect(descs[0]).toMatchObject({ kind: 'custom', key: 'branches' });
  });

  it('service exposes connector, a kv with-field, and credential', () => {
    const descs = descriptorsFor('service');
    expect(descs.find((d) => d.key === 'connector')).toMatchObject({ kind: 'text' });
    expect(descs.find((d) => d.key === 'with')).toMatchObject({ kind: 'kv', expr: true });
    expect(descs.find((d) => d.key === 'credential')).toMatchObject({ kind: 'text' });
  });

  it('form exposes title, a fields custom slot, and timeout fields', () => {
    const descs = descriptorsFor('form');
    expect(descs.find((d) => d.key === 'form.title')).toMatchObject({ kind: 'text' });
    expect(descs.find((d) => d.key === 'form.fields')).toMatchObject({ kind: 'custom' });
    expect(descs.find((d) => d.key === 'form.timeout.afterMinutes')).toMatchObject({ kind: 'number' });
    expect(descs.find((d) => d.key === 'form.timeout.onTimeout')).toMatchObject({ kind: 'select' });
  });

  it('call exposes ref and a kv with-field', () => {
    const descs = descriptorsFor('call');
    expect(descs.find((d) => d.key === 'ref')).toMatchObject({ kind: 'text' });
    expect(descs.find((d) => d.key === 'with')).toMatchObject({ kind: 'kv', expr: true });
  });

  it('set exposes a single kv set-field', () => {
    const descs = descriptorsFor('set');
    expect(descs.find((d) => d.key === 'set')).toMatchObject({ kind: 'kv', expr: true });
  });
});
