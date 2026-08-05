/**
 * message-markers — every block that rides a message body without being for the
 * reader, declared once.
 *
 * **Fenced blocks** sit next to the user's own words. They are stripped and the
 * rest of the message still renders as prose:
 *
 *   `\0__MF_SANDBOX_CAPTURE__`         capture rows for the attachment tiles;
 *                                      written by `features/run/format-captures.ts`,
 *                                      read by `view-model/parse-captures.ts`
 *   `Referenced session @session[…]: `  the transcript path a mention resolves to,
 *                                      addressed to the agent (#240); written by
 *                                      `session-references/reference-line.ts`
 *
 * **Whole-message forms** replace the entire turn with a card, so there is nothing
 * to strip — the parse either matches and the card renders, or it misses and the
 * raw text does. Their grammar lives with the parser:
 *
 *   ``Diff of `<file>` `` + `At line N:`   → ReviewCommentCard
 *                                            (`view-model/parse-review-comment.ts`)
 *   `Implement the following plan:`        → PlanBubble (`messages/plan-message.ts`)
 *
 * `\0__MF_PERMISSION__` (`view-model/map-assistant-blocks.ts`) is neither: the
 * projection invents it and it never travels on the wire.
 *
 * Adding a marker: name it here. If it is fenced, add its stripper to
 * `visibleMessageText` and mirror it in the daemon's `message_markers.rs` — both
 * session-title paths run that mirror, so a marker missing from it surfaces as a
 * title reading `\0__MF_…`.
 */

// ── Sandbox captures ──────────────────────────────────────────────────────────

export const SANDBOX_CAPTURE_SENTINEL = '\0__MF_SANDBOX_CAPTURE__';

export const CAPTURE_HEADER_LINE = '> **Preview captures**';

/** `> - \`label\` — selector \`sel\` — "annotation"`, the last two optional. */
export const CAPTURE_ROW_RE = /^> - `([^`]+)`(?: — selector `([^`]+)`)?(?: — "(.*)")?$/;

/**
 * The capture block split into its row lines and the trailing user text, or null
 * when the sentinel is absent. Shared by the row parser and the stripper so the
 * two can never disagree about where the block ends: a malformed line stops the
 * row run and everything from there on is `rest`.
 */
export function splitSandboxCaptureBlock(text: string): { rowLines: string[]; rest: string } | null {
  if (!text.startsWith(SANDBOX_CAPTURE_SENTINEL)) return null;
  const lines = text.slice(SANDBOX_CAPTURE_SENTINEL.length).replace(/^\n/, '').split('\n');
  let i = 0;
  if (lines[i]?.trim() === CAPTURE_HEADER_LINE) i += 1;
  const rowLines: string[] = [];
  for (; i < lines.length && CAPTURE_ROW_RE.test(lines[i] ?? ''); i += 1) {
    rowLines.push(lines[i]!);
  }
  return { rowLines, rest: lines.slice(i).join('\n').trim() };
}

export function stripSandboxCaptureBlock(text: string): string {
  return splitSandboxCaptureBlock(text)?.rest ?? text;
}

// ── Session references (#240) ─────────────────────────────────────────────────

export const SESSION_REFERENCE_LINE_RE = /^Referenced session @session\[([^\]\n]*)\]: (\S.*)$/;

/**
 * Removes every block-initial maximal run of reference lines (a run starting at
 * line 0 or preceded by a blank line) plus one adjacent blank line, so two
 * paragraphs that surrounded a run end up separated by exactly one blank line.
 * A matching line preceded by a non-empty line is left alone — that's what
 * makes decision D1's below-the-command layout strippable without also eating
 * unrelated reference-shaped prose.
 */
export function stripReferenceLines(text: string): string {
  const source = text.split('\n');
  const kept: string[] = [];
  let changed = false;
  let i = 0;

  while (i < source.length) {
    const blockInitial = i === 0 || source[i - 1] === '';
    if (blockInitial && SESSION_REFERENCE_LINE_RE.test(source[i]!)) {
      let end = i;
      while (end < source.length && SESSION_REFERENCE_LINE_RE.test(source[end]!)) end += 1;
      changed = true;
      if (end < source.length && source[end] === '') {
        end += 1;
      } else if (kept.length > 0 && kept[kept.length - 1] === '') {
        kept.pop();
      }
      i = end;
      continue;
    }
    kept.push(source[i]!);
    i += 1;
  }

  return changed ? kept.join('\n') : text;
}

// ── Composition ───────────────────────────────────────────────────────────────

/**
 * What the reader sees: every fenced block stripped. Idempotent, so it is safe on
 * text an earlier stage already cleaned (`convert-message` drops the capture block
 * before the renderer sees it). References go first: they are prepended at offset
 * 0, so stripping them is what restores a capture sentinel to the start of the
 * string where its own strip can find it.
 */
export function visibleMessageText(text: string): string {
  return stripSandboxCaptureBlock(stripReferenceLines(text));
}
