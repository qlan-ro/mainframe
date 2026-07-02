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

// Unordered dot: a 5px round dot in `mf-text-3`, centered in a 22px column,
// rendered via a `::before` pseudo-element on each direct `li` child (no
// per-item context needed — CSS handles it from the `ul` down). Excludes
// task-list items, which render their own bespoke checkbox instead.
const UL_MARKER_CLASS =
  '[&>li:not(.task-list-item)]:before:content-[""] [&>li:not(.task-list-item)]:before:inline-block' +
  ' [&>li:not(.task-list-item)]:before:size-[5px] [&>li:not(.task-list-item)]:before:rounded-full' +
  ' [&>li:not(.task-list-item)]:before:bg-mf-text-3 [&>li:not(.task-list-item)]:before:shrink-0' +
  ' [&>li:not(.task-list-item)]:before:mt-[7px] [&>li:not(.task-list-item)]:before:me-1.5';

// Ordered index: a mono, bold, accent 2-digit counter, rendered the same way —
// `counter-increment`/`content:counter()` on the `ol`'s direct `li` children.
const OL_MARKER_CLASS =
  '[counter-reset:aui-md-ol] [&>li]:[counter-increment:aui-md-ol]' +
  ' [&>li]:before:content-[counter(aui-md-ol,decimal-leading-zero)]' +
  ' [&>li]:before:font-mono [&>li]:before:font-bold [&>li]:before:text-primary' +
  ' [&>li]:before:text-caption [&>li]:before:shrink-0 [&>li]:before:w-[22px]' +
  ' [&>li]:before:inline-block';

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
        'aui-md-li flex items-baseline gap-1.5 leading-relaxed mt-1',
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
        'inline-flex size-[15px] shrink-0 items-center justify-center rounded-xs border-[1.5px]',
        checked ? 'border-mf-success bg-mf-success' : 'border-border bg-transparent',
      )}
    >
      {checked ? <Check size={11} className="text-white" strokeWidth={3} /> : null}
      <input type="checkbox" checked={checked} readOnly className="sr-only" {...props} />
    </span>
  );
}
