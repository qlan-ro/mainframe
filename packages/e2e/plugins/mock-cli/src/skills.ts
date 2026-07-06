// packages/e2e/plugins/mock-cli/src/skills.ts
// listSkills/listAgents for MockCliAdapter — scans ONLY the test project's `.claude/skills` and
// `.claude/agents` directories (no homedir scan), so e2e recordings that seed those dirs in the
// isolated temp project become deterministically visible in the Skills/Agents panels. Mirrors the
// real Claude adapter's project-scope scan (packages/core/src/plugins/builtin/claude/skills.ts)
// closely enough for e2e purposes; read/list only — no create/update/delete (not needed by any
// recorded scenario today). Uses `import type` only from @qlan-ro/mainframe-types (erased at
// bundle time, so this stays a zero-runtime-workspace-import module like fixture.ts).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Skill, AgentConfig } from '@qlan-ro/mainframe-types';

const ADAPTER_ID = 'mock-cli';

/** Tiny frontmatter reader — mirrors claude/frontmatter.ts's `parseFrontmatter` shape closely
 *  enough for `name`/`description` extraction; not a full YAML parser (matches the original). */
function parseFrontmatterAttrs(content: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (!content.startsWith('---')) return attributes;
  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return attributes;
  const block = content.slice(3, endIndex).trim();
  for (const line of block.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) attributes[key] = value;
  }
  return attributes;
}

/** Scans `<projectPath>/.claude/skills/<name>/SKILL.md`. Missing dirs/files are tolerated (empty result). */
export async function listSkills(projectPath: string): Promise<Skill[]> {
  const dir = path.join(projectPath, '.claude', 'skills');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  for (const name of entries) {
    const filePath = path.join(dir, name, 'SKILL.md');
    try {
      const raw = await readFile(filePath, 'utf-8');
      const attrs = parseFrontmatterAttrs(raw);
      skills.push({
        id: `${ADAPTER_ID}:project:${name}`,
        adapterId: ADAPTER_ID,
        name,
        displayName: attrs['name'] || name,
        description: attrs['description'] || '',
        scope: 'project',
        filePath,
        content: raw,
        invocationName: name,
      });
    } catch {
      // No SKILL.md for this entry — skip it.
    }
  }
  return skills;
}

/** Scans `<projectPath>/.claude/agents/*.md`. Missing dir is tolerated (empty result). */
export async function listAgents(projectPath: string): Promise<AgentConfig[]> {
  const dir = path.join(projectPath, '.claude', 'agents');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = path.join(dir, entry);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const name = entry.replace(/\.md$/, '');
      const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? '';
      const description = firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : firstLine;
      agents.push({
        id: `${ADAPTER_ID}:project:agent:${name}`,
        adapterId: ADAPTER_ID,
        name,
        description,
        scope: 'project',
        filePath,
        content: raw,
      });
    } catch {
      // Unreadable file — skip it.
    }
  }
  return agents;
}
