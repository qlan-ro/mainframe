/** Markdown outside a message part: a prompt, a result, a plan, a skill. */
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '@/lib/utils';
import { markdownComponents } from '../../parts/markdown-text';
import { remarkAppLinks, urlTransform } from '../../parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('aui-md min-w-0 wrap-break-word', className)}>
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
        {text}
      </Markdown>
    </div>
  );
}
