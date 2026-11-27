/**
 * Markdown outside a message part: a prompt, a result, a plan, a skill. Drawn by
 * the reply's own renderer, so a code block has its header and Copy here too.
 */
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '@/lib/utils';
import { MarkdownBody } from '../../parts/markdown-text';
import { remarkAppLinks } from '../../parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 wrap-break-word', className)}>
      <MarkdownBody text={text} remarkPlugins={REMARK_PLUGINS} />
    </div>
  );
}
