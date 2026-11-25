'use client';

/**
 * The one shape everything a draft carries has (C14): 172 × 40, a lead, two
 * lines that fade at the edge when they are longer, and a remove ×. The whole
 * text is in the tooltip.
 */
import type { ReactNode } from 'react';
import { FileIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FadeLabel } from '@/components/ui/fade-label';
import { cn } from '@/lib/utils';
import { extTint, fileExtMeta } from '../../messages/file-ext-colors';
import { ComposerHint } from '../composer-card-context';

interface DraftTileProps {
  testId: string;
  lead: ReactNode;
  title: ReactNode;
  detail: string;
  /** Paths, selectors and regions are read as code. */
  monoDetail?: boolean;
  /** The whole of it, for the tooltip. */
  full: string;
  /** Controls between the text and the ×. */
  actions?: ReactNode;
  remove: ReactNode;
  children?: ReactNode;
}

/** A shorter fade than the label's own: a tile's lines are 90 px. */
const FADE = 'data-truncated:[mask-image:linear-gradient(to_right,black_calc(100%-14px),transparent)]';

export function DraftTile({
  testId,
  lead,
  title,
  detail,
  monoDetail,
  full,
  actions,
  remove,
  children,
}: DraftTileProps) {
  return (
    <ComposerHint label={<span className="wrap-anywhere">{full}</span>}>
      <div
        data-testid={testId}
        className="group/tile relative flex h-10 w-43 shrink-0 items-center gap-2 rounded-[9px] bg-muted pr-0.5 pl-2 text-sm"
      >
        {children}
        {lead}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          {typeof title === 'string' ? (
            <FadeLabel className={cn(FADE, 'text-[12.5px]/tight', !monoDetail && 'font-medium')}>{title}</FadeLabel>
          ) : (
            title
          )}
          <FadeLabel
            className={cn(
              FADE,
              'text-muted-foreground dark:text-foreground/65',
              monoDetail ? 'font-mono text-[11px]/[1.3]' : 'text-[11.5px]/tight',
            )}
          >
            {detail}
          </FadeLabel>
        </span>
        {actions}
        {remove}
      </div>
    </ComposerHint>
  );
}

/** A file's extension, in its own color; a file without one gets the plain icon. */
export function ExtensionLead({ name }: { name: string }) {
  const meta = fileExtMeta(name);
  const ext = name.includes('.') ? meta.ext.slice(0, 4) : '';
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-md font-semibold uppercase"
      // Toward the ink of the theme: the bare hue is too faint for text this small.
      style={{
        fontSize: '0.5625rem',
        color: `color-mix(in oklab, ${meta.color} 45%, var(--foreground))`,
        background: extTint(meta.color),
      }}
    >
      {ext || <FileIcon className="size-3.5" />}
    </span>
  );
}

export function ThumbLead({ src }: { src?: string }) {
  return (
    <span aria-hidden className="size-8 shrink-0 overflow-hidden rounded-md bg-card ring-1 ring-border ring-inset">
      {src && <img src={src} alt="" className="size-full object-cover" />}
    </span>
  );
}

/** Above a tile's own overlay (`z-10`), so it stays the thing a press lands on. */
export function RemoveTileButton({ label, ...props }: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      className="relative z-20 size-6 text-muted-foreground"
      {...props}
    >
      <XIcon />
    </Button>
  );
}
