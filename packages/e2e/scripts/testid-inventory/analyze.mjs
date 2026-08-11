import { basename } from 'node:path';
import { collectDefinitions, collectReferences, collectTestIdSuffixes } from './extract.mjs';

/** @param {{ prefix: string, templated: boolean }} def @returns {string} */
export function displayId(def) {
  return def.templated ? `${def.prefix}\${…}` : def.prefix;
}

/** @param {{ prefix: string, templated: boolean }} def @param {string} value @returns {boolean} */
export function matchesDefinition(def, value) {
  return def.templated ? value.startsWith(def.prefix) : value === def.prefix;
}

/**
 * True when the ref's prefix is `<definition><suffix>` for some known
 * `data-testid` suffix — `git-confirm-dialog-confirm` against the definition
 * `git-confirm-dialog` and the harvested suffix `-confirm`.
 * @param {Array<{ prefix: string, templated: boolean }>} defs
 * @param {string[]} suffixes
 * @param {string} refPrefix
 * @returns {boolean}
 */
function matchesComposedSuffix(defs, suffixes, refPrefix) {
  return suffixes.some((suffix) => {
    if (!refPrefix.endsWith(suffix)) return false;
    const remainder = refPrefix.slice(0, refPrefix.length - suffix.length);
    return defs.some((def) => matchesDefinition(def, remainder));
  });
}

/**
 * True when some definition matches the ref's prefix directly, when —
 * either side is templated — the definition's prefix extends the ref's
 * shorter, rebuilt prefix (a spec closing over a narrower slice of the id),
 * or the ref composes a known `data-testid` suffix onto a live definition.
 * @param {Array<{ prefix: string, templated: boolean }>} defs
 * @param {{ prefix: string, templated: boolean }} ref
 * @param {string[]} [suffixes]
 * @returns {boolean}
 */
export function isLiveReference(defs, ref, suffixes = []) {
  const directMatch = defs.some((def) => {
    if (matchesDefinition(def, ref.prefix)) return true;
    if (def.templated || ref.templated) return def.prefix.startsWith(ref.prefix);
    return false;
  });
  return directMatch || matchesComposedSuffix(defs, suffixes, ref.prefix);
}

function bytewiseCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dedupeDefinitions(sourceFiles) {
  const byDisplayId = new Map();
  for (const { text } of sourceFiles) {
    for (const def of collectDefinitions(text)) {
      byDisplayId.set(displayId(def), def);
    }
  }
  return [...byDisplayId.values()].sort((a, b) => bytewiseCompare(displayId(a), displayId(b)));
}

function collectAllReferences(specFiles) {
  const broad = [];
  const strictBySpec = [];
  for (const { path, text } of specFiles) {
    const refs = collectReferences(text);
    broad.push(...refs.broad);
    strictBySpec.push({ spec: basename(path), strict: refs.strict });
  }
  return { broad, strictBySpec };
}

function buildDeadAndPerSpec(definitions, strictBySpec, suffixes) {
  const deadSpecsById = new Map();
  const perSpec = [];
  for (const { spec, strict } of strictBySpec) {
    let live = 0;
    let dead = 0;
    for (const ref of strict) {
      if (isLiveReference(definitions, ref, suffixes)) {
        live += 1;
        continue;
      }
      dead += 1;
      const id = displayId(ref);
      if (!deadSpecsById.has(id)) deadSpecsById.set(id, new Set());
      deadSpecsById.get(id).add(spec);
    }
    perSpec.push({ spec, live, dead });
  }
  perSpec.sort((a, b) => bytewiseCompare(a.spec, b.spec));
  const dead = [...deadSpecsById.entries()]
    .map(([id, specs]) => ({ id, specs: [...specs].sort(bytewiseCompare) }))
    .sort((a, b) => bytewiseCompare(a.id, b.id));
  return { dead, perSpec };
}

function surfaceOf(id) {
  const separatorIndex = id.indexOf('-');
  return separatorIndex === -1 ? id : id.slice(0, separatorIndex);
}

function buildBySurface(definitions, unused) {
  const unusedIds = new Set(unused.map(displayId));
  const bySurface = new Map();
  for (const def of definitions) {
    const surface = surfaceOf(displayId(def));
    const entry = bySurface.get(surface) ?? { surface, defined: 0, unused: 0 };
    entry.defined += 1;
    if (unusedIds.has(displayId(def))) entry.unused += 1;
    bySurface.set(surface, entry);
  }
  return [...bySurface.values()].sort((a, b) => b.unused - a.unused || bytewiseCompare(a.surface, b.surface));
}

/**
 * @param {{ sourceFiles: Array<{ path: string, text: string }>, specFiles: Array<{ path: string, text: string }> }} input
 */
export function analyze({ sourceFiles, specFiles }) {
  const definitions = dedupeDefinitions(sourceFiles);
  const { broad, strictBySpec } = collectAllReferences(specFiles);
  const suffixes = [...new Set(sourceFiles.flatMap(({ text }) => collectTestIdSuffixes(text)))];

  const unused = definitions.filter((def) => !broad.some((token) => matchesDefinition(def, token)));
  const unusedIds = new Set(unused.map(displayId));
  const referencedCount = definitions.length - unusedIds.size;

  const { dead, perSpec } = buildDeadAndPerSpec(definitions, strictBySpec, suffixes);
  const bySurface = buildBySurface(definitions, unused);

  return { definitions, definedCount: definitions.length, referencedCount, unused, dead, perSpec, bySurface };
}
