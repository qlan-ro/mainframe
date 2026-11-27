/**
 * The chip formatter: turns composer text into chip segments and back.
 *
 * A chip's label IS its wire text (`/review`, `@src/app.ts`, `@"a b.ts"`,
 * `@My session`), so `serialize` returns the label and every chip round-trips
 * to exactly the characters the textarea composer would have sent. The send
 * path (`use-submit-composition.ts`) reads `composer.text` and sees no change.
 *
 * `parse` runs when text arrives from outside the editor (thread switch, a
 * restored unsent message, a paste): the draft's session labels first, because
 * a title has spaces no pattern can find (#240), then the transcript's own
 * token grammar from `user-directives.ts`. react-lexical parses line by line,
 * so a `/command` is recognised at the start of a line; text after a session
 * label is mid-line and never opens one.
 */
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from '@assistant-ui/react';
import { mainframeUserFormatter, mainframeUserInlineFormatter } from '@/features/chat/messages/user-directives';
import { findSessionMentions } from '@/features/chat/session-references/session-mention';

export function createComposerChipFormatter(sessionLabels: readonly string[]): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => item.label,
    parse(text) {
      const segments: Unstable_DirectiveSegment[] = [];
      let last = 0;
      for (const mention of findSessionMentions(text, sessionLabels)) {
        pushTokens(segments, text.slice(last, mention.start), last);
        const label = text.slice(mention.start, mention.end);
        segments.push({ kind: 'mention', type: 'session', label, id: label.slice(1) });
        last = mention.end;
      }
      pushTokens(segments, text.slice(last), last);
      return segments.length > 0 ? segments : [{ kind: 'text', text }];
    },
  };
}

function pushTokens(segments: Unstable_DirectiveSegment[], text: string, base: number): void {
  if (text === '') return;
  const formatter = base === 0 ? mainframeUserFormatter : mainframeUserInlineFormatter;
  segments.push(...formatter.parse(text));
}
