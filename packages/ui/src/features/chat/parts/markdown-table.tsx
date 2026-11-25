/**
 * Markdown table components: wrapper, thead, th, td, tr.
 * Registered into markdownComponents' `table`/`thead`/`th`/`td`/`tr` slots.
 */
import type { ComponentProps } from 'react';

export function MarkdownTable({ children, ...props }: ComponentProps<'table'>) {
  return (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      data-testid="chat-markdown-table-scroll"
      className="my-3 overflow-x-auto rounded-lg border border-border focus-visible:focus-line-inset"
    >
      <table className="w-full table-fixed border-collapse text-sm/5 [overflow-wrap:anywhere]" {...props}>
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
    <th className="py-[3px] pl-0 pr-6 text-left font-medium text-foreground" {...props}>
      {children}
    </th>
  );
}

export function MarkdownTd({ children, ...props }: ComponentProps<'td'>) {
  return (
    <td className="border-t border-border py-[3px] pl-0 pr-6 text-foreground" {...props}>
      {children}
    </td>
  );
}

export function MarkdownTr({ children, ...props }: ComponentProps<'tr'>) {
  return <tr {...props}>{children}</tr>;
}
