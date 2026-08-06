/**
 * Markdown table components: wrapper, thead, th, td, tr.
 * Registered into markdownComponents' `table`/`thead`/`th`/`td`/`tr` slots.
 */
import type { ComponentProps } from 'react';

export function MarkdownTable({ children, ...props }: ComponentProps<'table'>) {
  return (
    <div className="rounded-md border border-border overflow-hidden my-3">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  );
}

export function MarkdownThead({ children, ...props }: ComponentProps<'thead'>) {
  return (
    <thead className="bg-muted" {...props}>
      {children}
    </thead>
  );
}

export function MarkdownTh({ children, ...props }: ComponentProps<'th'>) {
  return (
    <th className="px-3 py-2 text-left font-sans text-xs font-bold text-muted-foreground" {...props}>
      {children}
    </th>
  );
}

export function MarkdownTd({ children, ...props }: ComponentProps<'td'>) {
  return (
    <td className="border-t border-border px-3 py-2 font-sans text-xs text-foreground" {...props}>
      {children}
    </td>
  );
}

export function MarkdownTr({ children, ...props }: ComponentProps<'tr'>) {
  return (
    <tr className="even:bg-muted/50" {...props}>
      {children}
    </tr>
  );
}
