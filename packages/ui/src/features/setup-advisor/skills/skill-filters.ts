/**
 * Pure list logic for the Skills section: search, scope grouping, and the
 * delete-affordance gate.
 *
 * `isDeletable` is the UI's only defense: the daemon reports a refused delete
 * as a generic "Operation failed", so the affordance is gated by scope and
 * backing file rather than by an error the user would only see too late.
 * Command-derived entries (`.claude/commands/<group>/<cmd>.md`) are excluded
 * because the daemon removes the backing file's parent directory, which for a
 * command is the whole command group.
 */
import type { Skill } from '@qlan-ro/mainframe-types';

/** Display order of the scope groups; scopes with no members are dropped. */
const SCOPE_ORDER: readonly Skill['scope'][] = ['project', 'global', 'plugin'];

export interface SkillScopeGroup {
  scope: Skill['scope'];
  skills: Skill[];
}

function lastSeparator(filePath: string): number {
  return Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
}

/** The last path segment, across POSIX and Windows separators. */
function fileName(filePath: string): string {
  return filePath.slice(lastSeparator(filePath) + 1);
}

export function matchesQuery(skill: Skill, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [skill.displayName, skill.name, skill.description, skill.invocationName].some((field) =>
    (field ?? '').toLowerCase().includes(needle),
  );
}

export function groupByScope(skills: Skill[]): SkillScopeGroup[] {
  return SCOPE_ORDER.map((scope) => ({ scope, skills: skills.filter((s) => s.scope === scope) })).filter(
    (group) => group.skills.length > 0,
  );
}

export function isDeletable(skill: Skill): boolean {
  return skill.scope !== 'plugin' && fileName(skill.filePath) === 'SKILL.md';
}

/** The directory the daemon removes — named in the delete confirmation. */
export function skillDirectory(skill: Skill): string {
  const cut = lastSeparator(skill.filePath);
  return cut === -1 ? '' : skill.filePath.slice(0, cut);
}
