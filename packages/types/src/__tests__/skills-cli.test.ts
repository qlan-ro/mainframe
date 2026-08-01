/**
 * skills-cli.test.ts
 *
 * Red until `../skills-cli` exists (todo #243, plan Group D). Pins the Zod
 * schemas to the wire contract in
 * docs/plans/2026-08-01-todo-243-skills-management-ui-plan.md verbatim: the
 * manifest and probe discriminated unions, and the 502 failure shape that
 * carries `tail`/`exitCode` beyond the standard envelope.
 */
import { describe, it, expect } from 'vitest';
import { SkillsCliManifestSchema, SkillsCliProbeSchema, SkillsCliFailureSchema } from '../skills-cli';

const AVAILABLE_MANIFEST = {
  status: 'available',
  entries: [
    {
      name: 'shadcn',
      scope: 'project',
      source: 'shadcn/ui',
      sourceType: 'github',
      skillPath: 'skills/shadcn/SKILL.md',
    },
  ],
};

const UNAVAILABLE_MANIFEST = {
  status: 'unavailable',
  executable: 'skills',
  packageRunner: 'npx skills',
};

describe('SkillsCliManifestSchema', () => {
  it('parses the "available" wire body from the contract', () => {
    expect(SkillsCliManifestSchema.parse(AVAILABLE_MANIFEST)).toMatchObject(AVAILABLE_MANIFEST);
  });

  it('parses the "unavailable" wire body from the contract', () => {
    expect(SkillsCliManifestSchema.parse(UNAVAILABLE_MANIFEST)).toEqual(UNAVAILABLE_MANIFEST);
  });

  it('rejects an available manifest whose entry is missing name', () => {
    const { name: _drop, ...rest } = AVAILABLE_MANIFEST.entries[0]!;
    const result = SkillsCliManifestSchema.safeParse({ status: 'available', entries: [rest] });

    expect(result.success).toBe(false);
  });

  it('tolerates an unknown extra field on an entry', () => {
    const result = SkillsCliManifestSchema.safeParse({
      status: 'available',
      entries: [{ ...AVAILABLE_MANIFEST.entries[0], installedAt: '2026-01-01' }],
    });

    expect(result.success).toBe(true);
  });

  it('tolerates an unknown extra field on the unavailable body', () => {
    const result = SkillsCliManifestSchema.safeParse({ ...UNAVAILABLE_MANIFEST, hint: 'try npm i -g skills' });

    expect(result.success).toBe(true);
  });

  it('rejects a status outside the available/unavailable union', () => {
    expect(SkillsCliManifestSchema.safeParse({ status: 'installing', entries: [] }).success).toBe(false);
  });
});

describe('SkillsCliProbeSchema', () => {
  it('parses the "probed" wire body from the contract', () => {
    const body = { status: 'probed', skills: [{ name: 'shadcn', description: '…' }] };

    expect(SkillsCliProbeSchema.parse(body)).toEqual(body);
  });

  it('parses the "unparseable" wire body from the contract', () => {
    expect(SkillsCliProbeSchema.parse({ status: 'unparseable' })).toEqual({ status: 'unparseable' });
  });

  it('rejects a probed skill entry missing name', () => {
    const result = SkillsCliProbeSchema.safeParse({ status: 'probed', skills: [{ description: 'no name' }] });

    expect(result.success).toBe(false);
  });

  it('tolerates an unknown extra field on a probed skill', () => {
    const result = SkillsCliProbeSchema.safeParse({
      status: 'probed',
      skills: [{ name: 'shadcn', description: '…', category: 'ui' }],
    });

    expect(result.success).toBe(true);
  });
});

describe('SkillsCliFailureSchema', () => {
  it('parses the full 502 body with tail and a numeric exitCode', () => {
    const body = { success: false, error: 'boom', tail: 'error: boom', exitCode: 1 };

    expect(SkillsCliFailureSchema.parse(body)).toEqual(body);
  });

  it('parses a 502 body with a null exitCode (spawn failure / timeout)', () => {
    const body = { success: false, error: 'boom', tail: 'error: boom', exitCode: null };

    expect(SkillsCliFailureSchema.parse(body)).toEqual(body);
  });

  it('parses the standard failure body with tail and exitCode absent', () => {
    const body = { success: false, error: 'Project not found' };

    const parsed = SkillsCliFailureSchema.parse(body);

    expect(parsed).toEqual({ success: false, error: 'Project not found' });
    expect(parsed.tail).toBeUndefined();
  });

  it('rejects a success: true body', () => {
    expect(SkillsCliFailureSchema.safeParse({ success: true, data: {} }).success).toBe(false);
  });
});
