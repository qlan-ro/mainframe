/**
 * user-directives — Mainframe custom directive formatter for user-message text.
 *
 * The daemon emits plain text; mentions are written as `@path/to/file` tokens
 * (preceded by whitespace or start-of-string), and slash-commands appear as the
 * leading token `/command` in the message text.  The default assistant-ui
 * formatter expects `:type[label]{name=id}` syntax — so we supply our own.
 *
 * Patterns recognised:
 *   @[\w./\-]+ preceded by whitespace or start  → type='mention', label=token, id=path
 *   /[\w-]+   at the start of the string (opt.)  → type='command', label=/name, id=name
 *
 * serialize() is a no-op (we never write back to the composer via this formatter;
 * the composer's own @-mention trigger uses a separate formatter + trigger popover).
 */
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from '@assistant-ui/react';

// ── Regex ─────────────────────────────────────────────────────────────────────

/** @word/path mentions, only when preceded by whitespace or string start. */
const MENTION_RE = /(?:^|(?<=\s))(@[\w./\-]+)/g;

/** Leading /command token (first token only, at string start after optional ws). */
const COMMAND_RE = /^(\s*)(\/[\w-]+)/;

// ── Formatter ─────────────────────────────────────────────────────────────────

export const mainframeUserFormatter: Unstable_DirectiveFormatter = {
  /**
   * serialize() is unused for display-only rendering.
   * The type assertion satisfies the interface while making intent explicit.
   */
  serialize() {
    return '';
  },

  parse(text: string): readonly Unstable_DirectiveSegment[] {
    const segments: Unstable_DirectiveSegment[] = [];
    let workingText = text;

    // 1. Strip leading /command if present — emit it as a directive segment
    //    (this handles the rare case where `cleanText` includes the slash prefix).
    const cmdMatch = COMMAND_RE.exec(workingText);
    if (cmdMatch) {
      const leadingWs = cmdMatch[1] ?? '';
      const cmdToken = cmdMatch[2]!;
      if (leadingWs.length > 0) {
        segments.push({ kind: 'text', text: leadingWs });
      }
      const name = cmdToken.slice(1); // strip leading /
      segments.push({ kind: 'mention', type: 'command', label: cmdToken, id: name });
      workingText = text.slice(leadingWs.length + cmdToken.length);
    }

    // 2. Walk remaining text for @mention tokens
    let lastIndex = 0;
    MENTION_RE.lastIndex = 0; // reset global regex state

    for (const match of workingText.matchAll(MENTION_RE)) {
      const fullMatch = match[0]!;
      const token = match[1]!; // captured group: @path
      const tokenStart = match.index! + fullMatch.indexOf(token);

      // Emit preceding text (may include the whitespace before @token)
      if (tokenStart > lastIndex) {
        segments.push({ kind: 'text', text: workingText.slice(lastIndex, tokenStart) });
      }

      segments.push({ kind: 'mention', type: 'mention', label: token, id: token.slice(1) });
      lastIndex = tokenStart + token.length;
    }

    // 3. Emit trailing text
    if (lastIndex < workingText.length) {
      segments.push({ kind: 'text', text: workingText.slice(lastIndex) });
    }

    // If no segments were produced (no directives found), return a single text segment
    if (segments.length === 0) {
      return [{ kind: 'text', text }];
    }

    return segments;
  },
};
