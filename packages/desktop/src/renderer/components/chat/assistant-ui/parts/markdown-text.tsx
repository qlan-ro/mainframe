import React, { memo, useState } from 'react';
import type { TextMessagePartComponent } from '@assistant-ui/react';
import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../../../lib/utils';
import { urlTransform as markdownUrlTransform, remarkAppLinks } from '../../../../lib/markdown-url-transform';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../ui/tooltip';
import { ContextMenu, type ContextMenuItem } from '../../../ui/context-menu';
import { CodeHeader } from './CodeHeader';
import { SyntaxHighlightedCode } from './SyntaxHighlightedCode';

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (React.isValidElement(children) && children.props) {
    return extractText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function Code({ className, children, ...props }: React.ComponentProps<'code'>) {
  const isCodeBlock = useIsMarkdownCodeBlock();
  if (isCodeBlock) {
    const lang = className?.match(/language-(\w+)/)?.[1];
    const code = extractText(children);
    return (
      <div className="rounded-mf-card border border-mf-divider bg-mf-hover/20 overflow-hidden my-3">
        <CodeHeader language={lang} code={code} />
        <div className="border-t border-mf-divider">
          <SyntaxHighlightedCode code={code} language={lang} />
        </div>
      </div>
    );
  }
  return (
    <code className={cn('aui-md-inline-code', className)} {...props}>
      {children}
    </code>
  );
}

/* ── Custom table components ─────────────────────────────────── */

function MarkdownTable({ children, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="rounded-mf-card border border-mf-divider overflow-hidden my-3">
      <table className="w-full border-collapse text-mf-body" {...props}>
        {children}
      </table>
    </div>
  );
}

function MarkdownThead({ children, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead className="bg-mf-hover" {...props}>
      {children}
    </thead>
  );
}

function MarkdownTh({ children, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className="font-mono text-mf-label font-semibold uppercase tracking-wider text-mf-text-secondary px-3 py-2 text-left"
      {...props}
    >
      {children}
    </th>
  );
}

function MarkdownTd({ children, ...props }: React.ComponentProps<'td'>) {
  return (
    <td className="font-mono text-mf-small text-mf-text-primary px-3 py-2 border-t border-mf-divider/50" {...props}>
      {children}
    </td>
  );
}

function MarkdownTr({ children, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr className="even:bg-mf-hover/30" {...props}>
      {children}
    </tr>
  );
}

function LinkWithPreview({
  className,
  href,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const copyHref = (): void => {
    if (!href) return;
    navigator.clipboard.writeText(href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyUrl = (e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    copyHref();
  };

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!href) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  if (!href) {
    return <a className={cn('aui-md-a', className)} href={href} {...props} />;
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Copy link', onClick: copyHref },
    { label: 'Open link', onClick: () => window.mainframe.openExternal(href) },
  ];

  return (
    <>
      <Tooltip disableHoverableContent={false}>
        <TooltipTrigger asChild>
          <a
            className={cn('aui-md-a', className)}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              window.mainframe.openExternal(href);
            }}
            onContextMenu={handleContextMenu}
            {...props}
          />
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5 max-w-[400px]">
          <span className="truncate min-w-0">{href}</span>
          <button
            type="button"
            onClick={copyUrl}
            className="shrink-0 px-1.5 py-0.5 rounded bg-mf-hover hover:bg-mf-border text-mf-text-secondary hover:text-mf-text-primary transition-colors text-[10px]"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </TooltipContent>
      </Tooltip>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
}

export const markdownComponents = unstable_memoizeMarkdownComponents({
  h1: ({ className, ...props }) => <h1 className={cn('aui-md-h1', className)} {...props} />,
  h2: ({ className, ...props }) => <h2 className={cn('aui-md-h2', className)} {...props} />,
  h3: ({ className, ...props }) => <h3 className={cn('aui-md-h3', className)} {...props} />,
  h4: ({ className, ...props }) => <h4 className={cn('aui-md-h4', className)} {...props} />,
  p: ({ className, ...props }) => <p className={cn('aui-md-p', className)} {...props} />,
  a: LinkWithPreview,
  blockquote: ({ className, ...props }) => <blockquote className={cn('aui-md-blockquote', className)} {...props} />,
  ul: ({ className, ...props }) => <ul className={cn('aui-md-ul', className)} {...props} />,
  ol: ({ className, ...props }) => <ol className={cn('aui-md-ol', className)} {...props} />,
  li: ({ className, ...props }) => <li className={cn('aui-md-li', className)} {...props} />,
  hr: ({ className, ...props }) => <hr className={cn('aui-md-hr', className)} {...props} />,
  table: MarkdownTable,
  thead: MarkdownThead,
  th: MarkdownTh,
  td: MarkdownTd,
  tr: MarkdownTr,
  strong: ({ className, ...props }) => <strong className={cn('aui-md-strong', className)} {...props} />,
  del: ({ className, ...props }) => <del className={cn('aui-md-del', className)} {...props} />,
  pre: ({ children }) => <>{children}</>,
  code: Code,
});

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks];

export const MarkdownText: TextMessagePartComponent = memo(() => {
  return (
    <MarkdownTextPrimitive
      className="aui-md"
      remarkPlugins={REMARK_PLUGINS}
      urlTransform={markdownUrlTransform}
      components={markdownComponents}
    />
  );
});

MarkdownText.displayName = 'MarkdownText';
