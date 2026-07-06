/**
 * wf-slug — shared name-slugification helpers for the workflow editor.
 *
 * The daemon's `workflowSchema.name` is validated against `idSchema`
 * (`/^[a-zA-Z0-9_-]+$/`); both the builder's derived filename/id and the
 * YAML serializer's `name:` line must emit a slug, never raw display text.
 */

/** Slugify a workflow name for use as the id segment / YAML `name:` value. */
export function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

/** Derive a slugified name from a workflow's YAML by reading the `name:` line. */
export function deriveNameFromYaml(yaml: string): string {
  const m = yaml.match(/^name:\s*(.+)$/m);
  const raw = m?.[1] ?? '';
  return raw.trim().replace(/^["']|["']$/g, '');
}

/**
 * Derive a new workflow's daemon-facing id (`<scope>:<name>`) from its YAML
 * `name:` line and the builder's chosen scope.
 *
 * `packages/core/src/server/routes/workflows.ts` `resolveWorkflowDir` reads
 * scope from this id prefix (not from the YAML body): `'global'` writes to
 * `<dataDir>/workflows`, anything else is looked up as a project id and
 * writes to `<project.path>/.mainframe/workflows`. The builder has no
 * project picker, so `'project'` scope resolves to the active session's
 * project id (the same source `useActiveIdentity` feeds elsewhere in the
 * shell); with no active project known, it falls back to `global:` rather
 * than emitting an id that can never resolve to a directory.
 */
export function deriveWorkflowId(yaml: string, scope: 'global' | 'project', projectId?: string): string {
  const name = slug(deriveNameFromYaml(yaml));
  if (scope === 'project' && projectId) return `${projectId}:${name}`;
  return `global:${name}`;
}
