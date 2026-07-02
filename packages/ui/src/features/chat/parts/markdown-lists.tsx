/**
 * Markdown list rendering: ordered/unordered markers + task-list checkbox.
 *
 * Design (08-markdown.jsx:141-147): ordered items get a mono, bold, accent
 * 2-digit index (01, 02…); unordered items get a small round dot; task items
 * get a bespoke checkbox with a line-through label when checked. remark-gfm's
 * default renders raw browser markers / a bare native <input type="checkbox">,
 * which breaks the warm-chrome look — so `ul`/`ol` disable native markers and
 * `li` renders the appropriate marker itself via a CSS counter (ol) or a
 * static dot (ul); `input` overrides the task checkbox visual.
 *
 * Registered into markdownComponents' `ul`/`ol`/`li`/`input` slots.
 */
import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Unordered dot: a 5px round dot in `mf-text-3`, centered in the 22px hung
// marker gutter (`pl-[22px]` on the `li`), rendered via an absolutely
// positioned `::before` pseudo-element on each direct `li` child (no per-item
// context needed — CSS handles it from the `ul` down). Excludes task-list
// items, which render their own bespoke checkbox instead.
const UL_MARKER_CLASS =
  '[&>li:not(.task-list-item)]:before:content-[""] [&>li:not(.task-list-item)]:before:absolute' +
  ' [&>li:not(.task-list-item)]:before:size-[5px] [&>li:not(.task-list-item)]:before:rounded-full' +
  ' [&>li:not(.task-list-item)]:before:bg-mf-text-3' +
  ' [&>li:not(.task-list-item)]:before:left-[8.5px] [&>li:not(.task-list-item)]:before:top-[7px]';

// Ordered index: a mono, bold, accent 2-digit counter, rendered the same way —
// `counter-increment`/`content:counter()` on the `ol`'s direct `li` children,
// absolutely positioned in the 22px hung marker gutter.
const OL_MARKER_CLASS =
  '[counter-reset:aui-md-ol] [&>li]:[counter-increment:aui-md-ol]' +
  ' [&>li]:before:content-[counter(aui-md-ol,decimal-leading-zero)]' +
  ' [&>li]:before:font-mono [&>li]:before:font-bold [&>li]:before:text-primary' +
  ' [&>li]:before:text-caption [&>li]:before:absolute [&>li]:before:left-0' +
  ' [&>li]:before:w-[22px]';

export function MarkdownUl({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cn('aui-md-ul my-2 list-none', UL_MARKER_CLASS, className)} {...props} />;
}

export function MarkdownOl({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('aui-md-ol my-2 list-none', OL_MARKER_CLASS, className)} {...props} />;
}

export function MarkdownLi({ className, children, ...props }: ComponentProps<'li'>) {
  const isTask = typeof className === 'string' && className.includes('task-list-item');
  return (
    <li
      className={cn(
        // Normal block flow with a hung marker: the `::before` marker (dot or
        // ordered index, see UL_MARKER_CLASS/OL_MARKER_CLASS) is absolutely
        // positioned in the 22px `pl-[22px]` gutter, so mixed-inline children
        // (text runs, <code> chips, <strong>, links) flow as regular text
        // instead of being laid out as separate flex items (regression fix —
        // `display:flex` on the li made every inline child its own column).
        'aui-md-li relative pl-[22px] leading-relaxed mt-1',
        // Checked task items get a line-through label: :has() reaches the
        // sibling checkbox's data-checked state without per-item React context.
        isTask && 'aui-md-li-task has-[[data-checked=true]]:text-muted-foreground has-[[data-checked=true]]:line-through',
        className,
      )}
      {...props}
    >
      {children}
    </li>
  );
}

export function MarkdownTaskCheckbox({ checked, ...props }: ComponentProps<'input'>) {
  return (
    <span
      data-slot="md-task-checkbox"
      data-checked={checked ? 'true' : 'false'}
      aria-hidden
      className={cn(
        // Flows inline with the label text (task li keeps the pl-[22px]
        // gutter from MarkdownLi, but has no ::before marker — see
        // UL_MARKER_CLASS's :not(.task-list-item) exclusion — so this
        // checkbox is the only marker-like glyph and sits inline at the
        // start of the text run, nudged down to align with the label).
        'inline-flex size-[15px] shrink-0 translate-y-[2px] items-center justify-center rounded-xs border-[1.5px] me-1.5',
        checked ? 'border-mf-success bg-mf-success' : 'border-border bg-transparent',
      )}
    >
      {checked ? <Check size={11} className="text-white" strokeWidth={3} /> : null}
      <input type="checkbox" checked={checked} readOnly className="sr-only" {...props} />
    </span>
  );
}
