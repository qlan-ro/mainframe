import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderUnused, renderGapReport } from '../render.mjs';

const DATE = '2026-08-11';

function unusedReport() {
  return {
    definitions: [
      { prefix: 'chat-header-grip', templated: false },
      { prefix: 'chat-send-button', templated: false },
      { prefix: 'daemon-row-', templated: true },
      { prefix: 'gates-approve', templated: false },
      { prefix: 'gates-deny', templated: false },
    ],
    definedCount: 5,
    referencedCount: 2,
    unused: [
      { prefix: 'chat-header-grip', templated: false },
      { prefix: 'chat-send-button', templated: false },
      { prefix: 'daemon-row-', templated: true },
    ],
    dead: [],
    perSpec: [],
    bySurface: [
      { surface: 'chat', defined: 2, unused: 2 },
      { surface: 'daemon', defined: 1, unused: 1 },
      { surface: 'gates', defined: 2, unused: 0 },
    ],
  };
}

function gapReport() {
  return {
    definitions: [{ prefix: 'chat-send-button', templated: false }],
    definedCount: 1,
    referencedCount: 1,
    unused: [],
    dead: [{ id: 'ghost-button', specs: ['b.spec.ts'] }],
    perSpec: [
      { spec: 'a.spec.ts', live: 1, dead: 0 },
      { spec: 'b.spec.ts', live: 0, dead: 1 },
    ],
    bySurface: [{ surface: 'chat', defined: 1, unused: 0 }],
  };
}

test('renderUnused header states the generation date and all three counts', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(output.includes('_Generated 2026-08-11.'));
  assert.ok(output.includes('data-testids (5)'));
  assert.ok(output.includes('(2)'));
  assert.ok(output.includes('Unused: 3._'));
});

test('renderUnused contains no STALE banner', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(!output.includes('STALE'));
});

test('renderUnused keeps the false-positive caveat blockquote', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(output.includes('"Unused" means the test-id string isn\'t referenced'));
  assert.ok(output.includes('marks templated id families.'));
});

test('renderUnused groups ids by surface, ordered by unused count descending then surface ascending', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(output.includes('## chat (2)'));
  assert.ok(output.includes('## daemon (1)'));
  assert.ok(!output.includes('## gates'));
  assert.ok(output.indexOf('## chat (2)') < output.indexOf('## daemon (1)'));
});

test('renderUnused sorts ids inside a section bytewise and marks templated families with ${…}', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(output.indexOf('`chat-header-grip`') < output.indexOf('`chat-send-button`'));
  assert.ok(output.includes('`daemon-row-${…}`'));
});

test('renderGapReport opens with the literal _Generated <date>. token, recoverable by the round-trip regex', () => {
  const output = renderGapReport(gapReport(), DATE);
  assert.ok(output.includes('_Generated 2026-08-11.'));
  const match = /_Generated (\d{4}-\d{2}-\d{2})/.exec(output);
  assert.ok(match);
  assert.equal(match[1], '2026-08-11');
});

test('renderGapReport emits the Summary, Dead selectors, Per-spec health and Untested surfaces sections', () => {
  const output = renderGapReport(gapReport(), DATE);
  assert.ok(output.includes('## Summary'));
  assert.ok(output.includes('## Dead selectors'));
  assert.ok(output.includes('## Per-spec health'));
  assert.ok(output.includes('## Untested surfaces, ranked'));
});

test('renderGapReport contains none of the dropped hand-written narrative headings', () => {
  const output = renderGapReport(gapReport(), DATE);
  assert.ok(!output.includes('Test-only fixture IDs'));
  assert.ok(!output.includes('Beyond testids'));
  assert.ok(!output.includes('Dead selectors — CORRECTED'));
  assert.ok(!output.includes('Recommended sequencing'));
});

test('renderUnused ends with exactly one trailing newline', () => {
  const output = renderUnused(unusedReport(), DATE);
  assert.ok(output.endsWith('\n'));
  assert.ok(!output.endsWith('\n\n'));
});

test('renderGapReport ends with exactly one trailing newline', () => {
  const output = renderGapReport(gapReport(), DATE);
  assert.ok(output.endsWith('\n'));
  assert.ok(!output.endsWith('\n\n'));
});

test('renderUnused is pure: the same input renders the same string twice', () => {
  const report = unusedReport();
  assert.equal(renderUnused(report, DATE), renderUnused(report, DATE));
});

test('renderGapReport is pure: the same input renders the same string twice', () => {
  const report = gapReport();
  assert.equal(renderGapReport(report, DATE), renderGapReport(report, DATE));
});
