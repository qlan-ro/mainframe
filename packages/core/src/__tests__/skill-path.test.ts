import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSkillPath, resolveExistingSkillPath } from '../plugins/builtin/claude/skill-path.js';

const TEST_BASE = join(tmpdir(), 'mainframe-skillpath-test');

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, homedir: () => TEST_BASE };
});

function writeSkill(root: string, relPath: string, body = '# test\n'): string {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return full;
}

describe('resolveSkillPath input validation', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
    mkdirSync(TEST_BASE, { recursive: true });
  });
  afterEach(() => rmSync(TEST_BASE, { recursive: true, force: true }));

  it('rejects path-traversal names and returns empty fallback', () => {
    expect(resolveSkillPath(undefined, '../../etc/passwd')).toBe('');
    expect(resolveSkillPath(undefined, '../../../foo')).toBe('');
    expect(resolveSkillPath(undefined, 'foo/bar')).toBe('');
  });

  it('rejects names with path separators or null bytes', () => {
    expect(resolveSkillPath(undefined, 'a/b')).toBe('');
    expect(resolveSkillPath(undefined, 'a\\b')).toBe('');
    expect(resolveSkillPath(undefined, 'a\0b')).toBe('');
  });

  it('accepts plugin-qualified names (single colon)', () => {
    expect(resolveSkillPath(undefined, 'work-logger:slack-status-writer')).toContain('slack-status-writer/SKILL.md');
  });

  it('rejects multi-colon names', () => {
    expect(resolveSkillPath(undefined, 'a:b:c')).toBe('');
  });

  it('returns fallback path under homedir for valid unfound names', () => {
    const result = resolveSkillPath(undefined, 'nonexistent-skill');
    expect(result).toContain(TEST_BASE);
    expect(result).toContain('nonexistent-skill/SKILL.md');
  });
});

describe('resolveExistingSkillPath plugin-qualified resolution', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
    mkdirSync(TEST_BASE, { recursive: true });
  });
  afterEach(() => rmSync(TEST_BASE, { recursive: true, force: true }));

  it('returns null for invalid names', () => {
    expect(resolveExistingSkillPath(undefined, '../etc')).toBeNull();
    expect(resolveExistingSkillPath(undefined, 'a/b')).toBeNull();
  });

  it('finds plugin-qualified skill in cache layout', () => {
    const real = writeSkill(
      TEST_BASE,
      '.claude/plugins/cache/marketplace-name/work-logger/1.2.3/skills/slack-status-writer/SKILL.md',
    );
    const result = resolveExistingSkillPath(undefined, 'work-logger:slack-status-writer');
    expect(result).toBe(real);
  });

  it('finds plugin-qualified skill in non-cache plugin dir', () => {
    const real = writeSkill(TEST_BASE, '.claude/plugins/work-logger-plugin/skills/slack-status-writer/SKILL.md');
    const result = resolveExistingSkillPath(undefined, 'work-logger:slack-status-writer');
    expect(result).toBe(real);
  });

  it('resolveSkillPath (non-existing-aware) prefers real cached plugin path over fallback', () => {
    const real = writeSkill(TEST_BASE, '.claude/plugins/cache/m/work-logger/1.0.0/skills/slack-status-writer/SKILL.md');
    expect(resolveSkillPath(undefined, 'work-logger:slack-status-writer')).toBe(real);
  });
});
