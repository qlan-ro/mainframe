/**
 * Markdown outside a message part: a prompt, a result, a plan, a skill. Drawn by
 * the reply's own renderer, so a code block has its header and Copy here too.
 */
import { TextMessagePartProvider } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '@/lib/utils';
import { markdownComponents } from '../../parts/markdown-text';
import { remarkAppLinks, urlTransform } from '../../parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('min-w-0 wrap-break-word', className)}>
      <TextMessagePartProvider text={text}>
        <MarkdownTextPrimitive
          className="aui-md"
          remarkPlugins={REMARK_PLUGINS}
          urlTransform={urlTransform}
          smooth={false}
          components={markdownComponents}
        />
      </TextMessagePartProvider>
    </div>
  );
}
