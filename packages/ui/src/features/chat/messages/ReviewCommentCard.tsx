/**
 * ReviewCommentCard — a diff-review comment turn (desktop DiffTab/DiffView
 * "Diff of `file`" sends, parsed by parse-review-comment in the projection).
 *
 * The design's UMCodeRef covers one snippet+comment; this extends it (user
 * decision 2026-06-10) to the producer's real shape: ONE file card whose
 * header names the file, containing each comment as a section — line label +
 * numbered snippet (shared SnippetLines) + the comment styled as a small
 * user bubble inside the card. Sections separated by hairlines.
 */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { CodeIcon, QuoteIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import type { ReviewComment, ReviewCommentItem } from '../view-model/parse-review-comment';
import { rangeLabel, SnippetBlock } from './code-snippet';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

const COMMENT_BUBBLE_STYLE = {
  background: 'var(--mf-um-card)',
  boxShadow: 'var(--mf-shadow-user-card)',
} as const;

function CommentSection({ item, id }: { item: ReviewCommentItem; id: string }) {
  const lines = item.code ? item.code.split('\n') : [];
  return (
    <div data-testid={`chat-user-review-comment-L${item.start}`} className="flex flex-col gap-1.5 px-3 py-2.5">
      <span className="font-mono text-micro text-mf-text-4">{rangeLabel({ start: item.start, end: item.end })}</span>
      {lines.length > 0 && (
        <div className="select-text rounded-md border-[0.5px] border-border bg-mf-raised py-1">
          <SnippetBlock id={id} lines={lines} start={item.start} />
        </div>
      )}
      {/* The comment reads as a small user bubble inside the file card. */}
      <div
        style={COMMENT_BUBBLE_STYLE}
        className="aui-md self-end max-w-full rounded-xl border-[0.5px] border-mf-um-edge px-3 py-1.5 text-body leading-relaxed tracking-normal text-mf-um-ink"
      >
        <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
          {item.body}
        </Markdown>
      </div>
    </div>
  );
}

export function ReviewCommentCard({ review }: { review: ReviewComment }) {
  const fileName = review.file.split('/').pop() ?? review.file;
  return (
    <div
      data-testid="chat-user-review-comment"
      className="max-w-[75%] overflow-hidden rounded-[11px] border-[0.5px] border-border bg-mf-content2 shadow-sm"
    >
      <div className="flex items-center gap-2 border-b-[0.5px] border-border bg-mf-raised px-3 py-1.5">
        <CodeIcon size={12} className="flex-shrink-0 text-primary" />
        <Hint label={review.file}>
          <span className="min-w-0 truncate font-mono text-caption font-semibold text-muted-foreground">
            {fileName}
          </span>
        </Hint>
        <span className="flex-1" />
        {review.comments.length > 1 && (
          <span className="flex-shrink-0 font-mono text-micro text-mf-text-4">{review.comments.length} comments</span>
        )}
        <QuoteIcon size={11} className="flex-shrink-0 text-mf-text-4" />
      </div>
      {/* No /opacity modifier on token colors (CLAUDE.md token trap). */}
      <div className="divide-y divide-border">
        {review.comments.map((item, i) => {
          // start+end identifies a comment's line range; it's the only field
          // the producer guarantees (see parse-review-comment.ts) and two
          // comments can't share a range in practice, so it's stable across
          // re-renders. Index is only a last-resort disambiguator, not the
          // primary key, per the project's "no array-index domain ids" rule.
          const sectionId = `L${item.start}-${item.end ?? item.start}-${i}`;
          return <CommentSection key={sectionId} item={item} id={sectionId} />;
        })}
      </div>
    </div>
  );
}
