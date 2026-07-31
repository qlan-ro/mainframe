/**
 * user-directives — Mainframe custom directive formatter for user-message text.
 *
 * The daemon emits plain text; mentions are written as `@path/to/file` tokens
 * (preceded by whitespace or start-of-string), session references as
 * `@session[label]` tokens, and slash-commands as the leading token `/command`
 * in the message text.  The default assistant-ui formatter expects
 * `:type[label]{name=id}` syntax — so we supply our own.
 *
 * Patterns recognised:
 *   @session[label]                              → type='session', label=token, id=label
 *   @[\w./\-]+ preceded by whitespace or start   → type='mention', label=token, id=path
 *   /[\w-]+   at the start of the string (opt.)  → type='command', label=/name, id=name
 *
 * `label` always carries the token's full source characters: the composer
 * overlay pushes it verbatim and its concatenated textContent must equal the
 * textarea value char-for-char, or the caret drifts.
 *
 * serialize() is a no-op (we never write back to the composer via this formatter;
 * the composer's own @-mention trigger uses a separate formatter + trigger popover).
 */
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from '@assistant-ui/react';

// ── Regex ─────────────────────────────────────────────────────────────────────

/**
 * `@session[label]` and `@word/path` mentions, only when preceded by whitespace
 * or string start. The session alternative comes first so `@session[Foo]` is
 * never eaten as the bare mention `@session`.
 */
const TOKEN_RE = /(?:^|(?<=\s))(@session\[[^\]\n]*\]|@[\w./\-]+)/g;

const SESSION_PREFIX = '@session[';

/**
 * Leading /command token (first token only, at string start after optional ws).
 * Token chars match desktop parity — word chars plus `:` `.` `/` `-` so
 * namespaced (`/plugin:skill`), path (`/foo/bar`), and dotted commands highlight
 * as a single token, not just the leading `/word`.
 */
const COMMAND_RE = /^(\s*)(\/[\w:./-]+)/;

// ── Segment builders ──────────────────────────────────────────────────────────

function mentionSegment(token: string): Unstable_DirectiveSegment {
  if (token.startsWith(SESSION_PREFIX)) {
    return { kind: 'mention', type: 'session', label: token, id: token.slice(SESSION_PREFIX.length, -1) };
  }
  return { kind: 'mention', type: 'mention', label: token, id: token.slice(1) };
}

/** Walks `text` for @tokens, appending text + mention segments to `segments`. */
function pushTokenSegments(segments: Unstable_DirectiveSegment[], text: string): void {
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const fullMatch = match[0]!;
    const token = match[1]!;
    const tokenStart = match.index! + fullMatch.indexOf(token);

    // Emit preceding text (may include the whitespace before the token)
    if (tokenStart > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, tokenStart) });
    }

    segments.push(mentionSegment(token));
    lastIndex = tokenStart + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }
}

/** Consumes a leading `/command`, appending its segments; returns the remainder. */
function takeLeadingCommand(segments: Unstable_DirectiveSegment[], text: string): string {
  const cmdMatch = COMMAND_RE.exec(text);
  if (!cmdMatch) return text;

  const leadingWs = cmdMatch[1] ?? '';
  const cmdToken = cmdMatch[2]!;
  if (leadingWs.length > 0) {
    segments.push({ kind: 'text', text: leadingWs });
  }
  segments.push({ kind: 'mention', type: 'command', label: cmdToken, id: cmdToken.slice(1) });
  return text.slice(leadingWs.length + cmdToken.length);
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export interface UserFormatterOptions {
  /**
   * Recognize a leading `/command`. Off for text that is not the start of the
   * message — a markdown paragraph's second string child begins mid-sentence,
   * so a `/` there is prose, not a command.
   */
  recognizeCommand: boolean;
}

export function createUserFormatter({ recognizeCommand }: UserFormatterOptions): Unstable_DirectiveFormatter {
  return {
    /**
     * serialize() is unused for display-only rendering.
     * The type assertion satisfies the interface while making intent explicit.
     */
    serialize() {
      return '';
    },

    parse(text: string): readonly Unstable_DirectiveSegment[] {
      const segments: Unstable_DirectiveSegment[] = [];
      const rest = recognizeCommand ? takeLeadingCommand(segments, text) : text;
      pushTokenSegments(segments, rest);

      // If no segments were produced (no directives found), return a single text segment
      if (segments.length === 0) {
        return [{ kind: 'text', text }];
      }

      return segments;
    },
  };
}

export const mainframeUserFormatter = createUserFormatter({ recognizeCommand: true });

/** Same tokens, no command recognition — for non-leading markdown children. */
export const mainframeUserInlineFormatter = createUserFormatter({ recognizeCommand: false });
