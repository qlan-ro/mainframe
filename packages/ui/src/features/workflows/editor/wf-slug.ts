/**
 * wf-slug — shared name-slugification helpers for the workflow editor.
 *
 * The daemon's `workflowSchema.name` is validated against `idSchema`
 * (`/^[a-zA-Z0-9_-]+$/`, mirrored here as `ID_PATTERN`). The builder's
 * derived filename/id always slugs (they're routing/filesystem concerns).
 * The YAML serializer's `name:` line only slugs when the draft's name
 * doesn't already satisfy `ID_PATTERN` — a hydrated name like
 * `Release_Candidate` is valid under the daemon schema and must round-trip
 * unchanged; only free-text names typed in the builder need slugging.
 */

/** Mirrors core's `workflowSchema` `idSchema` regex (`packages/core/src/workflows/dsl/schema.ts`). */
export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

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
