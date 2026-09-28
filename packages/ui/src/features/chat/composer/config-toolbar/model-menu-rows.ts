/**
 * Pure shaping of an adapter's catalog into the model menu's sections.
 *
 * Split out of ProviderModelSelect so the render layer stays readable now that
 * each row carries its own tuning flyout.
 */
import type { AdapterModel } from '@qlan-ro/mainframe-types';
export { modelChoices as modelRows } from '@/lib/cli-model';

/** Labelled sections below the adapter's own models, in first-seen order. */
export function modelGroups(rows: AdapterModel[]): [string, AdapterModel[]][] {
  const groups = new Map<string, AdapterModel[]>();
  for (const m of rows) {
    if (!m.group) continue;
    const bucket = groups.get(m.group);
    if (bucket) bucket.push(m);
    else groups.set(m.group, [m]);
  }
  return [...groups];
}

export function groupSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** The three sections the menu renders, in order. */
export function partitionModels(rows: AdapterModel[]): {
  current: AdapterModel[];
  older: AdapterModel[];
  groups: [string, AdapterModel[]][];
} {
  const native = rows.filter((m) => !m.group);
  return {
    current: native.filter((m) => !m.isOlder),
    older: native.filter((m) => m.isOlder),
    groups: modelGroups(rows),
  };
}
