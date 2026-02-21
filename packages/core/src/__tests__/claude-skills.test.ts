import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  listAgents,
  createAgent,
  deleteAgent,
} from '../adapters/claude-skills.js';
import { parseFrontmatter } from '../adapters/frontmatter.js';

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'mf-skills-test-'));
  await mkdir(join(projectPath, '.claude', 'skills'), { recursive: true });
  await mkdir(join(projectPath, '.claude', 'agents'), { recursive: true });
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('returns empty array when no project skills exist', async () => {
    // listSkills may also return global skills, so we just verify no project skill we created
    const skills = await listSkills(projectPath);
    const projectSkills = skills.filter((s) => s.scope === 'project');
    expect(projectSkills).toHaveLength(0);
  });

  it('returns created skill in list', async () => {
    await createSkill(projectPath, {
      name: 'commit',
      displayName: 'Commit',
      description: 'Creates commits',
      scope: 'project',
      content: 'Make a commit.',
    });
    const skills = await listSkills(projectPath);
    const found = skills.find((s) => s.id === 'claude:project:commit');
    expect(found).toBeDefined();
    expect(found!.name).toBe('commit');
    expect(found!.scope).toBe('project');
  });
});

describe('createSkill', () => {
  it('creates a SKILL.md with frontmatter', async () => {
    const skill = await createSkill(projectPath, {
      name: 'review',
      displayName: 'Code Review',
      description: 'Reviews code',
      scope: 'project',
      content: 'Review body.',
    });

    expect(skill.id).toBe('claude:project:review');
    expect(skill.filePath).toContain('SKILL.md');

    const raw = await readFile(skill.filePath, 'utf-8');
    const { attributes, body } = parseFrontmatter(raw);
    expect(attributes['name']).toBe('Code Review');
    expect(attributes['description']).toBe('Reviews code');
    expect(body).toContain('Review body.');
  });
});

describe('updateSkill', () => {
  it('updates SKILL.md content', async () => {
    const created = await createSkill(projectPath, {
      name: 'fix',
      displayName: 'Fix',
      description: 'Fixes bugs',
      scope: 'project',
      content: 'Old content.',
    });

    const newContent = '---\nname: Fix v2\ndescription: Fixes bugs better\n---\n\nNew content.';
    const updated = await updateSkill(created.id, projectPath, newContent);

    expect(updated.displayName).toBe('Fix v2');
    const raw = await readFile(created.filePath, 'utf-8');
    expect(raw).toBe(newContent);
  });

  it('throws when skill not found', async () => {
    await expect(updateSkill('claude:project:nonexistent', projectPath, 'content')).rejects.toThrow('Skill not found');
  });
});

describe('deleteSkill', () => {
  it('removes the skill directory', async () => {
    await createSkill(projectPath, {
      name: 'cleanup',
      displayName: 'Cleanup',
      description: '',
      scope: 'project',
      content: '',
    });

    await deleteSkill('claude:project:cleanup', projectPath);

    const skills = await listSkills(projectPath);
    expect(skills.find((s) => s.name === 'cleanup')).toBeUndefined();
  });

  it('throws when skill not found', async () => {
    await expect(deleteSkill('claude:project:ghost', projectPath)).rejects.toThrow('Skill not found');
  });
});

describe('agents', () => {
  it('create + list + delete round-trip', async () => {
    const agent = await createAgent(projectPath, {
      name: 'test-agent',
      description: 'A test agent',
      scope: 'project',
      content: 'Agent instructions.',
    });

    expect(agent.id).toBe('claude:project:agent:test-agent');

    const agents = await listAgents(projectPath);
    expect(agents.find((a) => a.name === 'test-agent')).toBeDefined();

    await deleteAgent(agent.id, projectPath);
    const afterDelete = await listAgents(projectPath);
    expect(afterDelete.find((a) => a.name === 'test-agent')).toBeUndefined();
  });
});
