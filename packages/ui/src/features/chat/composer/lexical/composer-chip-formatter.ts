/**
 * The chip formatter: turns composer text into chip segments and back.
 *
 * A chip's label IS its wire text (`/review`, `@src/app.ts`, `@"a b.ts"`,
 * `@My session`), so `serialize` returns the label and every chip round-trips
 * to exactly the characters the textarea composer would have sent. The send
 * path (`use-submit-composition.ts`) reads `composer.text` and sees no change.
 *
 * The grammar is the transcript's (`user-directives.ts`), read over the whole
 * message the way the overlay (`render-highlights.tsx`) reads it: the draft's
 * session labels first, because a title has spaces no pattern can find (#240),
 * then the token patterns. A `/command` is a command only when it opens the
 * whole message; an `@` mention needs whitespace or the start of the text
 * before it. `findMessageTokens` is that reading with offsets, and every way
 * text enters a chip field (restore, paste, typing) picks its chips from it.
 *
 * `parse` treats its input as a whole message. react-lexical's SyncPlugin
 * calls it once per line, so a later line that starts with `/` comes back as a
 * command; `typed-chips.ts` turns such a chip back into text.
 */
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from '@assistant-ui/react';
import { mainframeUserFormatter, mainframeUserInlineFormatter } from '@/features/chat/messages/user-directives';
import { findSessionMentions } from '@/features/chat/session-references/session-mention';

type MentionSegment = Extract<Unstable_DirectiveSegment, { kind: 'mention' }>;

/** A token in the message: `text.slice(start, end) === segment.label`. */
export interface MessageToken {
  start: number;
  end: number;
  segment: MentionSegment;
}

export interface ComposerChipFormatter extends Unstable_DirectiveFormatter {
  /** Every token in `text`, read as a whole message. */
  tokens(text: string): MessageToken[];
}

/** The tokens in `text`, read as a whole message by the transcript's grammar. */
export function findMessageTokens(text: string, sessionLabels: readonly string[] = []): MessageToken[] {
  const tokens: MessageToken[] = [];
  let last = 0;
  for (const mention of findSessionMentions(text, sessionLabels)) {
    pushTokens(tokens, text.slice(last, mention.start), last);
    const label = text.slice(mention.start, mention.end);
    tokens.push({
      start: mention.start,
      end: mention.end,
      segment: { kind: 'mention', type: 'session', label, id: label.slice(1) },
    });
    last = mention.end;
  }
  pushTokens(tokens, text.slice(last), last);
  return tokens;
}

/** The formatter's tokens for `text`, which starts at `base` in the message. Only `base` 0 can open it. */
function pushTokens(tokens: MessageToken[], text: string, base: number): void {
  if (text === '') return;
  const formatter = base === 0 ? mainframeUserFormatter : mainframeUserInlineFormatter;
  let offset = base;
  for (const segment of formatter.parse(text)) {
    if (segment.kind === 'text') {
      offset += segment.text.length;
      continue;
    }
    tokens.push({ start: offset, end: offset + segment.label.length, segment });
    offset += segment.label.length;
  }
}

/** `text.slice(from, to)` as segments, with the tokens that lie wholly inside the range as mentions. */
export function segmentRange(
  text: string,
  tokens: readonly MessageToken[],
  from = 0,
  to = text.length,
): Unstable_DirectiveSegment[] {
  const segments: Unstable_DirectiveSegment[] = [];
  let last = from;
  for (const token of tokens) {
    if (token.start < from || token.end > to) continue;
    if (token.start > last) segments.push({ kind: 'text', text: text.slice(last, token.start) });
    segments.push(token.segment);
    last = token.end;
  }
  if (last < to) segments.push({ kind: 'text', text: text.slice(last, to) });
  return segments;
}

export function createComposerChipFormatter(sessionLabels: readonly string[]): ComposerChipFormatter {
  const tokens = (text: string) => findMessageTokens(text, sessionLabels);
  return {
    serialize: (item) => item.label,
    tokens,
    parse(text) {
      const segments = segmentRange(text, tokens(text));
      return segments.length > 0 ? segments : [{ kind: 'text', text }];
    },
  };
}
