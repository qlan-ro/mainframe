/**
 * Pure slicing logic for changelog-watch. No I/O, no console output — callers
 * (fetch-delta.mjs) own printing and network access so this module stays
 * trivially unit-testable and reusable from either fetch mode.
 *
 * Both fetch modes normalize to the same entry shape, `{id, body}`: the mode
 * decides how an id is read off the upstream payload, so nothing downstream
 * ever branches on which tool it is looking at.
 */

const HEADING_RE = /^## (.+)$/;

export function parseChangelogSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    const match = HEADING_RE.exec(line);
    if (match) {
      current = { id: match[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections.map(({ id, lines }) => ({ id, body: lines.join('\n').trim() }));
}

// Anchoring is positional: the changelog's own order (newest first) decides
// what counts as "newer than the anchor", never a semver comparison.
export function sectionsSince(sections, anchor, opts = {}) {
  return walkFromAnchor(sections, anchor, opts.max);
}

export function selectReleasesSince(releases, opts = {}) {
  const { lastTag, includePrerelease = false, max } = opts;
  const candidates = includePrerelease ? releases : releases.filter((r) => !r.prerelease);
  // The GitHub releases list is not published_at-ordered; sort before slicing.
  const sorted = [...candidates].sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  return walkFromAnchor(
    sorted.map((r) => ({ id: r.tag_name, body: r.body ?? '' })),
    lastTag,
    max,
  );
}

// With no cap, return everything newer than the anchor (newest first). With a
// cap, return the oldest unreviewed batch so repeated calls walk forward toward
// head instead of jumping straight there. `head` is reported even when the
// anchor is missing — callers need it to explain how far the fetch reached.
function walkFromAnchor(entries, anchor, max) {
  const head = entries[0]?.id;
  const idx = entries.findIndex((entry) => entry.id === anchor);
  if (idx === -1) {
    return { entries: [], head, reachedAnchor: false, truncated: false, nextAnchor: undefined };
  }
  const unreviewed = entries.slice(0, idx);
  if (max == null || unreviewed.length <= max) {
    return { entries: unreviewed, head, reachedAnchor: true, truncated: false, nextAnchor: undefined };
  }
  const batch = unreviewed.slice(unreviewed.length - max);
  return { entries: batch, head, reachedAnchor: true, truncated: true, nextAnchor: batch[0].id };
}

export function renderDelta(entries) {
  return entries.map((entry) => `## ${entry.id}\n\n${entry.body}`).join('\n\n');
}

export function nextStateFor(state, tool, { ref, at }) {
  return {
    ...state,
    tools: {
      ...state.tools,
      [tool]: { ...state.tools[tool], lastReviewedRef: ref, lastReviewedAt: at },
    },
  };
}

// The anchor may only advance over entries this run actually fetched; naming
// the anchor itself is the no-op that records "checked today, nothing new".
export function canAdvanceTo(ref, { anchor, entries }) {
  return ref === anchor || entries.some((entry) => entry.id === ref);
}
