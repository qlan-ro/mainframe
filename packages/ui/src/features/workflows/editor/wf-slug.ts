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
