import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from '@/features/chat/parts/markdown-text';
import { remarkAppLinks, urlTransform } from '@/features/chat/parts/markdown-url-transform';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

function Block({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="mt-0.5 mb-1.5 min-w-0">
      <h3 className="text-control font-medium text-(--mf-tr-secondary)">{label}</h3>
      <div className="aui-md text-control text-(--mf-tr-secondary) break-words">{children}</div>
    </section>
  );
}

export function ProseBlock({ label, testId, source }: { label: string; testId: string; source: string }) {
  if (source.trim() === '') return null;
  return (
    <Block label={label} testId={testId}>
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
        {source}
      </Markdown>
    </Block>
  );
}

/** Verbatim: neither Markdown nor HTML. */
export function TextBlock({ label, testId, source }: { label: string; testId: string; source: string }) {
  if (source.trim() === '') return null;
  return (
    <Block label={label} testId={testId}>
      <p className="whitespace-pre-wrap">{source}</p>
    </Block>
  );
}
