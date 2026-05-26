import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ScrollRowProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Color the gradient mask fades to. Must match the surrounding surface
   * background. Defaults to var(--mf-panel-bg); override per call site
   * (status bar = --mf-app-bg, composer card = --mf-input-bg, etc.).
   */
  fadeColor?: string;
  'data-testid'?: string;
}

export function ScrollRow({
  children,
  className,
  fadeColor = 'var(--mf-panel-bg)',
  'data-testid': dataTestId,
}: ScrollRowProps): React.ReactElement {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = React.useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const measure = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 0;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const observeChildren = () => {
      Array.from(el.children).forEach((child) => {
        if (child instanceof Element) ro.observe(child);
      });
    };
    observeChildren();
    const mo = new MutationObserver(() => {
      ro.disconnect();
      ro.observe(el);
      observeChildren();
      measure();
    });
    mo.observe(el, { childList: true });
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [measure]);

  const handleScroll = React.useCallback(() => measure(), [measure]);

  const handleFocusIn = React.useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === scrollerRef.current) return;
    target.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, []);

  const fadeStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    background:
      side === 'left'
        ? `linear-gradient(to right, ${fadeColor}, transparent)`
        : `linear-gradient(to left, ${fadeColor}, transparent)`,
  });

  return (
    <div className={cn('relative min-w-0', className)}>
      <div
        ref={scrollerRef}
        dir="ltr"
        data-testid={dataTestId}
        onScroll={handleScroll}
        onFocus={handleFocusIn}
        className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5"
      >
        {children}
      </div>
      {overflow.left && (
        <div
          data-scroll-fade="left"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-6"
          style={fadeStyle('left')}
        />
      )}
      {overflow.right && (
        <div
          data-scroll-fade="right"
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6"
          style={fadeStyle('right')}
        />
      )}
    </div>
  );
}
