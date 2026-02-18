import { describe, it, expect } from 'vitest';
import { CreateSkillBody, CreateAgentBody } from '../server/routes/schemas.js';

describe('CreateSkillBody', () => {
  it('rejects names with path separators', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: '../evil',
    });
    expect(result.success).toBe(false);
  });

  it('rejects names with backslashes', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: '..\\evil',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid names', () => {
    const result = CreateSkillBody.safeParse({
      projectPath: '/tmp/project',
      name: 'my-skill_v2',
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateAgentBody', () => {
  it('rejects names with path separators', () => {
    const result = CreateAgentBody.safeParse({
      projectPath: '/tmp/project',
      name: 'foo/bar',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid names', () => {
    const result = CreateAgentBody.safeParse({
      projectPath: '/tmp/project',
      name: 'my-agent',
    });
    expect(result.success).toBe(true);
  });
});
