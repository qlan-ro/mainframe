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
      className="mf-tr-table my-3 overflow-x-auto rounded-[8px] focus-visible:focus-line-inset"
    >
      <table className="w-full border-collapse text-sm/5" {...props}>
        {children}
      </table>
    </div>
  );
}

export function MarkdownThead({ children, ...props }: ComponentProps<'thead'>) {
  return <thead {...props}>{children}</thead>;
}

export function MarkdownTh({ children, ...props }: ComponentProps<'th'>) {
  return (
    <th className="bg-(--mf-tr-table-header) px-3 py-[7px] text-left font-medium" {...props}>
      {children}
    </th>
  );
}

export function MarkdownTd({ children, ...props }: ComponentProps<'td'>) {
  return (
    <td className="px-3 py-[7px]" {...props}>
      {children}
    </td>
  );
}

export function MarkdownTr({ children, ...props }: ComponentProps<'tr'>) {
  return <tr {...props}>{children}</tr>;
}
