/**
 * Pure helpers for the binary surface diff: pull named surfaces (slash
 * commands, CLI flags, protocol subtypes, env vars, schema keys) out of a
 * CLI bundle's text, diff two versions, and render the result. No I/O here;
 * binary-diff.mjs owns the network and the filesystem.
 *
 * The patterns read the minified JavaScript a Bun single-file executable
 * embeds verbatim. They are deliberately literal: a missed surface costs a
 * line in the report, a loose pattern buries the real changes in noise.
 */

export const SURFACES = [
  {
    id: 'commands',
    title: 'Slash commands',
    // {type:"local",name:"project",description:…}
    patterns: [/type:"(?:local|local-jsx|prompt)",name:"([a-z_][a-z0-9:_-]*)"/g],
  },
  {
    id: 'flags',
    title: 'CLI flags',
    // .option("--foo <x>", …) and the hidden addOption(new X("--foo", …))
    patterns: [/(?:\.option|\.requiredOption|new [A-Za-z$_][\w$]{0,3})\("(--[a-z][a-z0-9-]*)/g],
  },
  {
    id: 'subtypes',
    title: 'Protocol subtypes (control requests, system events)',
    patterns: [/subtype:"([a-z][a-z0-9_]*)"/g],
  },
  {
    id: 'env',
    title: 'Environment variables',
    patterns: [
      /process\.env\.([A-Z_][A-Z0-9_]{2,})\b/g,
      /process\.env\["([A-Z_][A-Z0-9_]{2,})"\]/g,
      // Bare names need a JS delimiter on both sides: Bun's string table
      // packs entries back to back, so a plain \b boundary reads the next
      // entry's length byte into the name (CLAUDE_CODE_ARTIFACT_MCP6), and
      // a template prefix (`CLAUDE_CODE_CLIENT_${…}`) is not a variable.
      /(?<=["'`\s(\[{,=:])((?:CLAUDE|ANTHROPIC)_[A-Z0-9_]*[A-Z0-9])(?=["'`\s)\]},;:.=])/g,
    ],
  },
  {
    id: 'schemaKeys',
    title: 'Described schema keys (settings and tool inputs)',
    // key:o().optional().describe(…) — a zod field with a description.
    patterns: [
      /[{,]([a-zA-Z][A-Za-z0-9]{2,}):[A-Za-z$_][\w$]{0,3}\([^()]{0,40}\)(?:\.[a-z]+\([^()]{0,40}\)){0,3}\.describe\(/g,
    ],
  },
];

/** Longest match any pattern can produce; the scanner's chunk overlap must exceed it. */
export const MAX_MATCH_LENGTH = 512;

export function emptySurfaceSets() {
  return Object.fromEntries(SURFACES.map((surface) => [surface.id, new Set()]));
}

/**
 * Adds every surface found in `text` to `sets`. `limit` excludes matches that
 * start at or after it, so a chunked scanner can leave a tail for the next
 * chunk to rescan whole instead of recording a match cut off mid-identifier.
 */
export function extractSurfaces(text, sets, limit = text.length) {
  for (const surface of SURFACES) {
    for (const pattern of surface.patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (match.index >= limit) break;
        if (match[0].length > MAX_MATCH_LENGTH) continue;
        sets[surface.id].add(match[1]);
      }
    }
  }
  return sets;
}

export function diffSurfaces(from, to) {
  const diff = {};
  for (const { id } of SURFACES) {
    const before = from[id] ?? new Set();
    const after = to[id] ?? new Set();
    diff[id] = {
      added: [...after].filter((item) => !before.has(item)).sort(),
      removed: [...before].filter((item) => !after.has(item)).sort(),
    };
  }
  return diff;
}

export function changeCount(diff) {
  return Object.values(diff).reduce((sum, { added, removed }) => sum + added.length + removed.length, 0);
}

/**
 * A removed item the checklist names is the one that can break Mainframe
 * silently, so the render marks it. Matching is on the literal string with
 * identifier boundaries, so `--resume` does not claim `--resume-session-at`.
 */
export function citedIn(item, checklistText) {
  if (!checklistText) return false;
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(checklistText);
}

function renderItems(items, checklistText, markCited) {
  return items.map((item) => {
    const cited = markCited && citedIn(item, checklistText) ? ' — **cited by the checklist**' : '';
    return `- \`${item}\`${cited}`;
  });
}

export function renderBinaryDiff({ tool, from, to, diff, checklistText }) {
  const lines = [
    `# Binary surface diff: ${tool} ${from} → ${to}`,
    '',
    `Changes: ${changeCount(diff)}. Extracted from the bundle text, not run.`,
    'Each item is either announced (matches a changelog entry in the same range) or',
    'unannounced; classify the unannounced ones per classification.md.',
    '',
  ];
  for (const surface of SURFACES) {
    const { added, removed } = diff[surface.id];
    if (added.length === 0 && removed.length === 0) continue;
    lines.push(`## ${surface.title}`, '');
    if (added.length > 0) lines.push(`Added (${added.length}):`, '', ...renderItems(added, checklistText, false), '');
    if (removed.length > 0) {
      lines.push(`Removed (${removed.length}):`, '', ...renderItems(removed, checklistText, true), '');
    }
  }
  if (changeCount(diff) === 0) lines.push('No surface changes.', '');
  return lines.join('\n');
}
