import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseChangelogSections,
  sectionsSince,
  selectReleasesSince,
  renderDelta,
  nextStateFor,
  tagForVersion,
  versionForTag,
} from './changelog-delta.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const claudeChangelog = readFileSync(path.join(scriptsDir, 'fixtures/claude-changelog.sample.md'), 'utf8');
const codexReleases = JSON.parse(readFileSync(path.join(scriptsDir, 'fixtures/codex-releases.sample.json'), 'utf8'));

test('parseChangelogSections splits on "## " only, in file order', () => {
  const sections = parseChangelogSections(claudeChangelog);
  assert.deepEqual(
    sections.map((s) => s.version),
    ['2.1.219', '2.1.218', '2.1.217', '2.1.216'],
  );
  const withSubheading = sections.find((s) => s.version === '2.1.218');
  assert.match(withSubheading.body, /### Bug Fixes/);
});

test('sectionsSince returns entries newer than the anchor, anchor excluded', () => {
  const sections = parseChangelogSections(claudeChangelog);
  const result = sectionsSince(sections, '2.1.217');
  assert.deepEqual(
    result.entries.map((e) => e.version),
    ['2.1.219', '2.1.218'],
  );
  assert.equal(result.reachedAnchor, true);
});

test('sectionsSince reports an unknown anchor as unreached, not "everything is new"', () => {
  const sections = parseChangelogSections(claudeChangelog);
  const result = sectionsSince(sections, '9.9.9');
  assert.equal(result.reachedAnchor, false);
  assert.deepEqual(result.entries, []);
});

test('sectionsSince walks forward from the oldest unreviewed version when capped', () => {
  const sections = parseChangelogSections(claudeChangelog);
  const result = sectionsSince(sections, '2.1.216', { max: 1 });
  assert.deepEqual(
    result.entries.map((e) => e.version),
    ['2.1.217'],
  );
  assert.equal(result.truncated, true);
  assert.equal(result.nextAnchor, '2.1.217');
});

test('selectReleasesSince drops prereleases by default and sorts by published_at descending', () => {
  const result = selectReleasesSince(codexReleases, { lastTag: 'rust-v0.63.0' });
  assert.deepEqual(
    result.entries.map((e) => e.tag_name),
    ['rust-v0.65.0', 'rust-v0.64.0'],
  );
});

test('selectReleasesSince keeps prereleases when asked', () => {
  const result = selectReleasesSince(codexReleases, {
    lastTag: 'rust-v0.63.0',
    includePrerelease: true,
  });
  assert.ok(result.entries.some((e) => e.tag_name === 'rust-v0.64.1-alpha.5'));
  assert.ok(result.entries.some((e) => e.tag_name === 'rust-v0.64.1-alpha.3.1'));
});

test('selectReleasesSince reports an unknown lastTag as unreached', () => {
  const result = selectReleasesSince(codexReleases, { lastTag: 'rust-v9.9.9' });
  assert.equal(result.reachedAnchor, false);
});

test('selectReleasesSince(max:1) returns the oldest unreviewed stable release', () => {
  const result = selectReleasesSince(codexReleases, { lastTag: 'rust-v0.63.0', max: 1 });
  assert.deepEqual(
    result.entries.map((e) => e.tag_name),
    ['rust-v0.64.0'],
  );
  assert.equal(result.truncated, true);
  assert.equal(result.nextAnchor, 'rust-v0.64.0');
});

test('renderDelta emits the whole release body, including the raw PR list', () => {
  const result = selectReleasesSince(codexReleases, { lastTag: 'rust-v0.63.0', max: 1 });
  const rendered = renderDelta('codex', result.entries);
  assert.match(rendered, /#7268/);
});

test('nextStateFor updates only the named tool entry', () => {
  const state = {
    version: 1,
    tools: {
      claude: { lastReviewedVersion: '2.1.206', lastReviewedAt: '2026-07-25' },
      codex: { lastReviewedVersion: 'rust-v0.144.3', lastReviewedAt: '2026-07-25' },
    },
  };
  const next = nextStateFor(state, 'codex', { version: 'rust-v0.65.0', at: '2026-07-25' });
  assert.equal(next.tools.codex.lastReviewedVersion, 'rust-v0.65.0');
  assert.equal(next.tools.codex.lastReviewedAt, '2026-07-25');
  assert.deepEqual(next.tools.claude, state.tools.claude);
});

test('tagForVersion / versionForTag round-trip', () => {
  assert.equal(tagForVersion('0.144.3', 'rust-v'), 'rust-v0.144.3');
  assert.equal(versionForTag('rust-v0.144.3', 'rust-v'), '0.144.3');
  assert.equal(tagForVersion('2.1.219', 'v'), 'v2.1.219');
  assert.equal(versionForTag('v2.1.219', 'v'), '2.1.219');
});
