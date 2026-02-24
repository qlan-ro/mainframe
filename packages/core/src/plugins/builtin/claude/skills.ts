import { readdir, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Skill, AgentConfig, CreateSkillInput, CreateAgentInput } from '@mainframe/types';
import { parseFrontmatter, buildFrontmatter } from './frontmatter.js';

// TODO rename as claude-tools.ts

const ADAPTER_ID = 'claude';

export async function listSkills(projectPath: string): Promise<Skill[]> {
  const skills = new Map<string, Skill>();
  const home = homedir();

  await scanSkillsDir(path.join(projectPath, '.claude', 'skills'), 'project', skills);
  await scanCommandsDir(path.join(projectPath, '.claude', 'commands'), 'project', skills);
  await scanSkillsDir(path.join(home, '.claude', 'skills'), 'global', skills);
  await scanCommandsDir(path.join(home, '.claude', 'commands'), 'global', skills);

  const pluginsPath = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  try {
    const pluginsRaw = await readFile(pluginsPath, 'utf-8');
    const pluginsFile = JSON.parse(pluginsRaw) as {
      version?: number;
      plugins?: Record<string, { scope: string; installPath: string; projectPath?: string }[]>;
    };

    const pluginsMap = pluginsFile.plugins ?? {};
    for (const [key, installations] of Object.entries(pluginsMap)) {
      const pluginName = key.split('@')[0];
      for (const install of installations) {
        const pluginSkillsDir = path.join(install.installPath, 'skills');
        await scanSkillsDir(pluginSkillsDir, 'plugin', skills, pluginName);
      }
    }
  } catch {
    // No plugins file or parse error
  }

  return [...skills.values()];
}

async function scanSkillsDir(
  dir: string,
  scope: 'project' | 'global' | 'plugin',
  skills: Map<string, Skill>,
  pluginName?: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const skillMdPath = path.join(dir, entry, 'SKILL.md');
    try {
      const resolvedPath = await realpath(skillMdPath);
      const raw = await readFile(resolvedPath, 'utf-8');
      const { attributes } = parseFrontmatter(raw);

      const name = entry;
      const invocationName = pluginName ? `${pluginName}:${name}` : name;
      const id = `${ADAPTER_ID}:${scope}:${pluginName ? pluginName + ':' : ''}${name}`;

      if (scope === 'global' && skills.has(`${ADAPTER_ID}:project:${name}`)) continue;

      skills.set(id, {
        id,
        adapterId: ADAPTER_ID,
        name,
        displayName: attributes['name'] || name,
        description: attributes['description'] || '',
        scope,
        pluginName,
        filePath: resolvedPath,
        content: raw,
        invocationName,
      });
    } catch {
      // Missing SKILL.md or unresolvable symlink
    }
  }
}

async function scanCommandsDir(dir: string, scope: 'project' | 'global', skills: Map<string, Skill>): Promise<void> {
  let groups: string[];
  try {
    groups = await readdir(dir);
  } catch {
    return;
  }

  for (const group of groups) {
    const groupDir = path.join(dir, group);
    let entries: string[];
    try {
      entries = await readdir(groupDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(groupDir, entry);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const { attributes } = parseFrontmatter(raw);

        const commandName = entry.replace(/\.md$/, '');
        const invocationName = `${group}:${commandName}`;
        const name = invocationName;
        const id = `${ADAPTER_ID}:${scope}:${name}`;

        if (scope === 'global' && skills.has(`${ADAPTER_ID}:project:${name}`)) continue;

        skills.set(id, {
          id,
          adapterId: ADAPTER_ID,
          name,
          displayName: attributes['name'] || invocationName,
          description: attributes['description'] || '',
          scope,
          filePath,
          content: raw,
          invocationName,
        });
      } catch {
        // Unreadable file
      }
    }
  }
}

export async function listAgents(projectPath: string): Promise<AgentConfig[]> {
  const agents: AgentConfig[] = [];

  for (const [scope, dir] of [
    ['project', path.join(projectPath, '.claude', 'agents')],
    ['global', path.join(homedir(), '.claude', 'agents')],
  ] as const) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(dir, entry);
      try {
        const raw = await readFile(filePath, 'utf-8');
        const name = entry.replace(/\.md$/, '');
        const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || '';
        const description = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : firstLine;
        const id = `${ADAPTER_ID}:${scope}:agent:${name}`;

        agents.push({ id, adapterId: ADAPTER_ID, name, description, scope, filePath, content: raw });
      } catch {
        // Unreadable file
      }
    }
  }

  return agents;
}

export async function createSkill(projectPath: string, input: CreateSkillInput): Promise<Skill> {
  const base =
    input.scope === 'project' ? path.join(projectPath, '.claude', 'skills') : path.join(homedir(), '.claude', 'skills');

  const skillDir = path.join(base, input.name);
  await mkdir(skillDir, { recursive: true });

  const content = buildFrontmatter({ name: input.displayName, description: input.description }, input.content);
  const filePath = path.join(skillDir, 'SKILL.md');
  await writeFile(filePath, content, 'utf-8');

  const id = `${ADAPTER_ID}:${input.scope}:${input.name}`;
  return {
    id,
    adapterId: ADAPTER_ID,
    name: input.name,
    displayName: input.displayName,
    description: input.description,
    scope: input.scope,
    filePath,
    content,
    invocationName: input.name,
  };
}

export async function updateSkill(skillId: string, projectPath: string, content: string): Promise<Skill> {
  const skills = await listSkills(projectPath);
  const skill = skills.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);

  await writeFile(skill.filePath, content, 'utf-8');

  const { attributes } = parseFrontmatter(content);
  return {
    ...skill,
    content,
    displayName: attributes['name'] || skill.name,
    description: attributes['description'] || '',
  };
}

export async function deleteSkill(skillId: string, projectPath: string): Promise<void> {
  const skills = await listSkills(projectPath);
  const skill = skills.find((s) => s.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  if (skill.scope === 'plugin') throw new Error('Cannot delete plugin skills');

  const skillDir = path.dirname(skill.filePath);
  await rm(skillDir, { recursive: true, force: true });
}

export async function createAgent(projectPath: string, input: CreateAgentInput): Promise<AgentConfig> {
  const base =
    input.scope === 'project' ? path.join(projectPath, '.claude', 'agents') : path.join(homedir(), '.claude', 'agents');

  await mkdir(base, { recursive: true });
  const filePath = path.join(base, `${input.name}.md`);
  const content = `# ${input.name}\n\n${input.content}`;
  await writeFile(filePath, content, 'utf-8');

  const id = `${ADAPTER_ID}:${input.scope}:agent:${input.name}`;
  return {
    id,
    adapterId: ADAPTER_ID,
    name: input.name,
    description: input.description,
    scope: input.scope,
    filePath,
    content,
  };
}

export async function updateAgent(agentId: string, projectPath: string, content: string): Promise<AgentConfig> {
  const agents = await listAgents(projectPath);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  await writeFile(agent.filePath, content, 'utf-8');

  const firstLine = content.split('\n').find((l) => l.trim().length > 0) || '';
  const description = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : firstLine;
  return { ...agent, content, description };
}

export async function deleteAgent(agentId: string, projectPath: string): Promise<void> {
  const agents = await listAgents(projectPath);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  await rm(agent.filePath, { force: true });
}
