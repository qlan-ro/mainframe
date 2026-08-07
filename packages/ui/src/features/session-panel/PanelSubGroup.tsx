/**
 * PanelSubGroup — the block a panel section groups rows into: a small label, a
 * count, an optional trailing action, then the rows.
 *
 * Grouping is carried by the eyebrow and a rule, not by a filled box. The panel
 * is one glass surface — rows sit flat on it and only hover paints, as an ink
 * wash rather than a fill, since an opaque swatch would punch a hole in the
 * translucency. A tinted shell here would put a second material inside the first.
 *
 * The Context section stacks four of these (memory files · session mentions ·
 * skills · attachments), which is why the shell is a component rather than four
 * copies of the same three divs.
 */
import type { ReactNode } from 'react';
import { Badge } from '@v2/components/ui/badge';

/** The row shape every sub-group renders: memory files, session items, skills. */
export const SUB_GROUP_ROW =
  'flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-foreground/8';

interface PanelSubGroupProps {
  label: string;
  count: number;
  /** A single control on the trailing edge — the Skills group's Manage link. */
  action?: ReactNode;
  children: ReactNode;
}

export function PanelSubGroup({ label, count, action, children }: PanelSubGroupProps) {
  return (
    <div className="not-first:mt-0.5 not-first:border-t not-first:border-border not-first:pt-1">
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <span className="text-2xs font-medium text-muted-foreground">{label}</span>
        <Badge variant="outline">{count}</Badge>
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </div>
  );
}
