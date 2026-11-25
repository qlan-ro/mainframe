import type { AnchorHTMLAttributes, ReactElement } from 'react';
import { LinkAnchor } from './LinkAnchor';
import { useOpenLink } from './use-open-link';

export function WebLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  const { open, openIn } = useOpenLink();
  if (!href) return <a {...props} className="mf-link" />;
  return (
    <LinkAnchor
      {...props}
      href={href}
      onOpen={() => open(href)}
      onOpenIn={(key) => openIn(href, key === 'open-browser' ? 'browser' : 'workspace')}
    />
  );
}
