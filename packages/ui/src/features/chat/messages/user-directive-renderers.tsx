/**
 * user-directive-renderers — inline renderers for directives inside user text.
 *
 * Three tokens reach here from `mainframeUserFormatter`:
 *   /command      → boxed chip (design 7.1)
 *   @mention      → plain accent text, no box
 *   @session[…]   → SessionChip, the only token with its own chrome
 *
 * Only the first string child of a paragraph can open a slash-command, so the
 * inline formatter (no command recognition) renders every later child.
 */
import { Children, type ReactNode } from 'react';
import { MessageSquare, Wrench } from 'lucide-react';
import { createDirectiveText } from '@/components/ui/assistant-ui/directive-text';
import { markdownComponents } from '../parts/markdown-text';
import { labelSlug } from '../session-references/reference-label';
import { mainframeUserFormatter, mainframeUserInlineFormatter } from './user-directives';

const COMPLETE = { type: 'complete' } as const;

/** The toolbar branch-chip shape on directive inks, so a reference reads as the same object class. */
const SESSION_CHIP =
  'inline-flex h-[22px] min-w-0 max-w-[230px] items-center gap-[5px] rounded-[6px] border-[0.5px] border-solid border-border bg-mf-chip px-[6px] align-middle font-mono text-label font-normal text-mf-directive-session';

/**
 * A session reference, shown as its disambiguated label. The path and project
 * stay out of the transcript — the label is what the user picked and what the
 * agent reads in the reference line above the message.
 */
function SessionChip({ id }: { id: string }) {
  return (
    <span
      data-testid={`chat-message-session-chip-${labelSlug(id)}`}
      data-directive-type="session"
      className={SESSION_CHIP}
    >
      <MessageSquare size={12} className="shrink-0" />
      <span className="truncate">{id}</span>
    </span>
  );
}

const CHIP_RENDERERS = { session: ({ id }: { id: string }) => <SessionChip id={id} /> };

const UserDirectiveText = createDirectiveText(mainframeUserFormatter, {
  iconMap: { command: Wrench },
  plainTypes: ['mention'],
  renderers: CHIP_RENDERERS,
});

const UserInlineDirectiveText = createDirectiveText(mainframeUserInlineFormatter, {
  plainTypes: ['mention'],
  renderers: CHIP_RENDERERS,
});

/**
 * `<p>` override for react-markdown. Every string child is scanned for
 * directives; non-string children (bold, links, code) pass through untouched.
 */
function DirectiveParagraph({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const kids = Children.toArray(children);
  return (
    <p {...props}>
      {kids.map((child: ReactNode, i) =>
        typeof child !== 'string' ? (
          child
        ) : i === 0 ? (
          <UserDirectiveText key={i} type="text" text={child} status={COMPLETE} />
        ) : (
          <UserInlineDirectiveText key={i} type="text" text={child} status={COMPLETE} />
        ),
      )}
    </p>
  );
}

export const userMarkdownComponents = { ...markdownComponents, p: DirectiveParagraph };
