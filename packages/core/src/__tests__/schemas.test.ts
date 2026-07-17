import { describe, it, expect } from 'vitest';
import { CreateSkillBody, CreateAgentBody } from '../server/routes/schemas.js';

describe('CreateSkillBody', () => {
  it.each([
    ['../evil', false],
    ['..\\evil', false],
    ['my-skill_v2', true],
  ])('name %j → success:%s', (name, expectedSuccess) => {
    const result = CreateSkillBody.safeParse({ projectPath: '/tmp/project', name });
    expect(result.success).toBe(expectedSuccess);
  });
});

describe('CreateAgentBody', () => {
  it.each([
    ['foo/bar', false],
    ['my-agent', true],
  ])('name %j → success:%s', (name, expectedSuccess) => {
    const result = CreateAgentBody.safeParse({ projectPath: '/tmp/project', name });
    expect(result.success).toBe(expectedSuccess);
  });
});
