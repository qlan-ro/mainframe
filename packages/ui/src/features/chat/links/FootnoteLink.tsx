/** A footnote marker, or a note's way back: jumps inside its own reply, since every reply numbers from 1. */
import type { AnchorHTMLAttributes, MouseEvent, ReactElement } from 'react';

export function FootnoteLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  const jump = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const id = decodeURIComponent(href!.slice(1));
    const note = event.currentTarget.closest('.aui-md')?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!note) return;
    if (!note.matches('a, button, [tabindex]')) note.tabIndex = -1;
    note.scrollIntoView({ block: 'nearest' });
    note.focus({ preventScroll: true });
  };
  return (
    <a
      {...props}
      href={href}
      data-testid="chat-footnote-link"
      onClick={jump}
      className="mf-link rounded-sm no-underline! focus-visible:focus-line"
    >
      {children}
    </a>
  );
}
