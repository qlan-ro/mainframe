/**
 * Pure slicing logic for changelog-watch. No I/O, no console output — callers
 * (fetch-delta.mjs) own printing and network access so this module stays
 * trivially unit-testable and reusable from either fetch mode.
 */

const HEADING_RE = /^## (.+)$/;

export function parseChangelogSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    const match = HEADING_RE.exec(line);
    if (match) {
      current = { version: match[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map(({ version, lines }) => ({ version, body: lines.join('\n').trim() }));
}

// Anchoring is positional: the changelog's own order (newest first) decides
// what counts as "newer than the anchor", never a semver comparison.
export function sectionsSince(sections, anchor, opts = {}) {
  const idx = sections.findIndex((s) => s.version === anchor);
  if (idx === -1) {
    return { entries: [], reachedAnchor: false, truncated: false, nextAnchor: undefined };
  }
  return sliceForwardWalk(sections.slice(0, idx), opts.max, (entry) => entry.version);
}

export function selectReleasesSince(releases, opts = {}) {
  const { lastTag, includePrerelease = false, max } = opts;
  const filtered = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  // The GitHub releases list is not published_at-ordered; sort before slicing.
  const sorted = [...filtered].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  const idx = sorted.findIndex((r) => r.tag_name === lastTag);
  if (idx === -1) {
    return { entries: [], reachedAnchor: false, truncated: false, nextAnchor: undefined };
  }
  return sliceForwardWalk(sorted.slice(0, idx), max, (entry) => entry.tag_name);
}

// Shared by both anchor walks: with no cap, return everything newer than the
// anchor (newest first). With a cap, return the oldest unreviewed batch so
// repeated calls walk forward toward head instead of jumping straight there.
function sliceForwardWalk(unreviewed, max, idOf) {
  if (max == null || unreviewed.length <= max) {
    return { entries: unreviewed, reachedAnchor: true, truncated: false, nextAnchor: undefined };
  }
  const batch = unreviewed.slice(unreviewed.length - max);
  return { entries: batch, reachedAnchor: true, truncated: true, nextAnchor: idOf(batch[0]) };
}

export function renderDelta(tool, entries) {
  const idOf = tool === 'codex' ? (entry) => entry.tag_name : (entry) => entry.version;
  return entries.map((entry) => `## ${idOf(entry)}\n\n${entry.body}`).join('\n\n');
}

export function nextStateFor(state, tool, { version, at }) {
  return {
    ...state,
    tools: {
      ...state.tools,
      [tool]: { ...state.tools[tool], lastReviewedVersion: version, lastReviewedAt: at },
    },
  };
}

export function tagForVersion(version, tagPrefix) {
  return `${tagPrefix}${version}`;
}

export function versionForTag(tag, tagPrefix) {
  if (!tag.startsWith(tagPrefix)) {
    throw new Error(`tag "${tag}" does not start with prefix "${tagPrefix}"`);
  }
  return tag.slice(tagPrefix.length);
}
