/* PROTOTYPE — #355 file-reference link variants + #341 unified link menu rows.
 * Opening is stubbed with a toast; the real change routes through the open-file
 * surface intent. */
import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { ExternalLink, FileCode2, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { mfToast } from '@/lib/toast';
import { writeToClipboard } from '@/lib/editor/copy-reference';

const PROJECT = '/Users/doruchiulan/Projects/qlan/mainframe/';

export function isFileHref(href: string | undefined): boolean {
  if (!href) return false;
  return href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.startsWith('file://') || /^[\w.-]+\//.test(href);
}

function splitTarget(href: string): { path: string; line?: number } {
  const clean = href.replace(/^file:\/\//, '');
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(clean);
  return m ? { path: m[1] ?? clean, line: Number(m[2]) } : { path: clean };
}

function openStub(href: string) {
  const { path, line } = splitTarget(href);
  mfToast({ type: 'info', title: `open-file → ${path}${line ? `:${line}` : ''}` });
}

function FileRefMenu({ href, children }: { href: string; children: ReactElement }) {
  const { path } = splitTarget(href);
  const abs = path.startsWith('/') ? path : PROJECT + path.replace(/^\.\//, '');
  const rel = abs.startsWith(PROJECT) ? abs.slice(PROJECT.length) : abs;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem data-testid={`chat-fileref-open-${rel}`} onClick={() => openStub(href)}>
            <FolderOpen className="size-3.5" /> Open file
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => void writeToClipboard(abs)}>Copy absolute path</ContextMenuItem>
          <ContextMenuItem onClick={() => void writeToClipboard(rel)}>Copy relative path</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface FileRefLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant: string;
}

export function FileRefLink({ href, variant, className, children, ...props }: FileRefLinkProps): ReactElement {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    openStub(href);
  };
  const common = { href, onClick, onContextMenu: (e: React.MouseEvent) => e.stopPropagation(), ...props };

  if (variant === 'B') {
    return (
      <FileRefMenu href={href}>
        <a
          {...common}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline font-mono text-xs text-primary hover:bg-accent',
            className,
          )}
        >
          <FileCode2 className="size-3 shrink-0 opacity-70" />
          <span className="truncate">{children}</span>
        </a>
      </FileRefMenu>
    );
  }
  if (variant === 'C') {
    return (
      <FileRefMenu href={href}>
        <a
          {...common}
          className={cn(
            'group/ref inline-flex items-center gap-0.5 font-mono text-xs text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:decoration-primary',
            className,
          )}
        >
          {children}
          <ExternalLink className="ml-0.5 size-3 text-muted-foreground opacity-0 transition-opacity group-hover/ref:opacity-100" />
        </a>
      </FileRefMenu>
    );
  }
  return (
    <FileRefMenu href={href}>
      <a
        {...common}
        className={cn(
          'aui-md-a inline-flex items-center gap-1 border-b border-primary/40 text-primary no-underline hover:opacity-80',
          className,
        )}
      >
        <FileCode2 className="size-3 shrink-0" />
        {children}
      </a>
    </FileRefMenu>
  );
}

/** #341: the "Open in Mainframe" row every http(s) link gains; stubbed. */
export function openInMainframeStub(href: string) {
  mfToast({ type: 'info', title: `open-url-tab → ${href}` });
}
