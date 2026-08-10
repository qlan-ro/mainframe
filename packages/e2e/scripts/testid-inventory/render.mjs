import { displayId } from './analyze.mjs';

const CAVEAT_BLOCKQUOTE = [
  '> "Unused" means the test-id string isn\'t referenced in a Playwright locator or passed as a bare',
  '> string to a helper. Some of these elements ARE exercised via role/text locators (e.g. permission',
  '> buttons via getByRole), so this lists selector gaps, not necessarily untested behavior. `${…}`',
  '> marks templated id families.',
].join('\n');

function surfaceOf(id) {
  const separatorIndex = id.indexOf('-');
  return separatorIndex === -1 ? id : id.slice(0, separatorIndex);
}

function renderUnusedSection(surface, count, unusedIdsForSurface) {
  const lines = [`## ${surface} (${count})`, ''];
  for (const id of unusedIdsForSurface) lines.push(`- \`${id}\``);
  return lines.join('\n');
}

/** @param {import('./analyze.mjs').Report} report @param {string} date @returns {string} */
export function renderUnused(report, date) {
  const header = [
    '# e2e — test-ids not referenced by any test',
    '',
    `_Generated ${date}. Source: packages/ui/src data-testids (${report.definedCount}) minus e2e references`,
    `(${report.referencedCount}). Unused: ${report.unused.length}._`,
    '',
    CAVEAT_BLOCKQUOTE,
  ].join('\n');

  // report.unused is already bytewise-sorted by analyze(); mapping preserves that order.
  const unusedDisplayIds = report.unused.map(displayId);
  const sections = report.bySurface
    .filter((entry) => entry.unused > 0)
    .map((entry) => {
      const idsForSurface = unusedDisplayIds.filter((id) => surfaceOf(id) === entry.surface);
      return renderUnusedSection(entry.surface, entry.unused, idsForSurface);
    });

  return [header, '', sections.join('\n\n'), ''].join('\n');
}

function renderSummaryTable(report) {
  return [
    '## Summary',
    '',
    '| Metric | Count |',
    '|---|---|',
    `| Defined | ${report.definedCount} |`,
    `| Referenced | ${report.referencedCount} |`,
    `| Unused | ${report.unused.length} |`,
    `| Dead selectors | ${report.dead.length} |`,
  ].join('\n');
}

function renderDeadSelectorsSection(dead) {
  const lines = ['## Dead selectors', ''];
  if (dead.length === 0) {
    lines.push('_None._');
  } else {
    for (const entry of dead) lines.push(`- \`${entry.id}\` — referenced by: ${entry.specs.join(', ')}`);
  }
  return lines.join('\n');
}

function renderPerSpecSection(perSpec) {
  const lines = ['## Per-spec health', '', '| Spec | Live | Dead |', '|---|---|---|'];
  for (const entry of perSpec) lines.push(`| ${entry.spec} | ${entry.live} | ${entry.dead} |`);
  return lines.join('\n');
}

function renderBySurfaceSection(bySurface) {
  const lines = ['## Untested surfaces, ranked', '', '| Surface | Defined | Unused |', '|---|---|---|'];
  for (const entry of bySurface) lines.push(`| ${entry.surface} | ${entry.defined} | ${entry.unused} |`);
  return lines.join('\n');
}

/** @param {import('./analyze.mjs').Report} report @param {string} date @returns {string} */
export function renderGapReport(report, date) {
  const header = [
    '# e2e — test-id coverage gap report',
    '',
    `_Generated ${date}. Source: packages/ui/src data-testids and`,
    'packages/e2e/{tests-tauri,helpers,fixtures} references. Method: same diff as UNUSED-TESTIDS.md,',
    'read in both directions._',
    '',
    CAVEAT_BLOCKQUOTE,
  ].join('\n');

  const sections = [
    renderSummaryTable(report),
    renderDeadSelectorsSection(report.dead),
    renderPerSpecSection(report.perSpec),
    renderBySurfaceSection(report.bySurface),
  ];

  return [header, '', sections.join('\n\n'), ''].join('\n');
}
