/**
 * Markdown table components: wrapper, thead, th, td, tr.
 * Registered into markdownComponents' `table`/`thead`/`th`/`td`/`tr` slots.
 */
import type { ComponentProps } from 'react';

export function MarkdownTable({ children, ...props }: ComponentProps<'table'>) {
  return (
    <div className="rounded-md border border-border overflow-hidden my-3">
      <table className="w-full border-collapse text-body" {...props}>
        {children}
      </table>
    </div>
  );
}

export function MarkdownThead({ children, ...props }: ComponentProps<'thead'>) {
  return (
    <thead className="bg-mf-content2" {...props}>
      {children}
    </thead>
  );
}

export function MarkdownTh({ children, ...props }: ComponentProps<'th'>) {
  return (
    <th className="font-sans text-label font-bold text-muted-foreground px-3 py-2 text-left" {...props}>
      {children}
    </th>
  );
}

export function MarkdownTd({ children, ...props }: ComponentProps<'td'>) {
  return (
    <td className="font-sans text-label text-foreground px-3 py-2 border-t border-border" {...props}>
      {children}
    </td>
  );
}

export function MarkdownTr({ children, ...props }: ComponentProps<'tr'>) {
  return (
    <tr className="even:bg-mf-content2" {...props}>
      {children}
    </tr>
  );
}
