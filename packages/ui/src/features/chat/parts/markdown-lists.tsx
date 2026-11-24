/**
 * Markdown list rendering: native markers, and a task-list checkbox that reads
 * as a state rather than as a disabled control (T1b).
 *
 * Registered into markdownComponents' `ul`/`ol`/`li`/`input` slots.
 */
import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MarkdownUl({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      className={cn(
        'aui-md-ul my-2 list-disc pl-5.5 [&.contains-task-list]:list-none [&.contains-task-list]:pl-0',
        className,
      )}
      {...props}
    />
  );
}

export function MarkdownOl({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('aui-md-ol my-2 list-decimal pl-5.5', className)} {...props} />;
}

export function MarkdownLi({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('aui-md-li mt-1', className)} {...props} />;
}

export function MarkdownTaskCheckbox({ checked, ...props }: ComponentProps<'input'>) {
  return (
    <span
      data-slot="md-task-checkbox"
      data-checked={checked ? 'true' : 'false'}
      className={cn(
        'me-2 inline-grid size-3.5 translate-y-0.5 place-items-center rounded-sm',
        checked ? 'bg-mf-tr-link text-background' : 'border border-input',
      )}
    >
      {checked ? <Check aria-hidden className="size-2.5" strokeWidth={3} /> : null}
      <span className="sr-only">{checked ? 'Done: ' : 'Not done: '}</span>
      <input type="checkbox" checked={checked} readOnly {...props} aria-hidden tabIndex={-1} className="hidden" />
    </span>
  );
}
