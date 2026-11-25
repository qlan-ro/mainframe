/** What a row opens on: one grey surface, 8 px corners, mono 12/19 (T1). */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useRetainedValue } from '@/components/ui/disclosure-state';

export function Surface({ className, children, testId }: { className?: string; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'mf-tr-mono mf-editor-selectable min-w-0 overflow-x-auto rounded-lg bg-mf-tr-code text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A scrollable region a keyboard can reach. */
export function ScrollRegion({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid={testId}
      className={cn('max-h-96 overflow-auto rounded-lg focus-visible:focus-line-inset', className)}
    >
      {children}
    </div>
  );
}

export function KeyValue({
  label,
  tone,
  testId,
  children,
}: {
  label: string;
  tone?: 'fail';
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="px-3 py-2 not-first:border-t not-first:border-border">
      <div
        className={cn('mf-tr-meta mb-0.5 font-sans font-medium text-muted-foreground', tone === 'fail' && 'text-fail')}
      >
        {label}
      </div>
      {typeof children === 'string' ? (
        <pre data-testid={testId} className="wrap-break-word whitespace-pre-wrap">
          {children}
        </pre>
      ) : (
        <div data-testid={testId}>{children}</div>
      )}
    </div>
  );
}

/** Text under or over a surface. */
export function BodyNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="mf-tr-meta mb-1.5 text-muted-foreground">
      {children}
    </p>
  );
}

const PREVIEW_LINES = 12;

/** A long body shows its first lines and says how many more there are. */
export function useClampedLines<T>(id: string, lines: readonly T[], limit = PREVIEW_LINES) {
  const [all, setAll] = useRetainedValue(`all-lines:${id}`, false);
  // Two more lines cost less than the control that would hide them.
  const clamped = !all && lines.length > limit + 2;
  return {
    shown: clamped ? lines.slice(0, limit) : lines,
    hidden: clamped ? lines.length - limit : 0,
    showAll: () => setAll(true),
  };
}

export function ShowMore({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="mf-tr-meta mt-1 -ml-1.5 inline-flex h-6 items-center rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:focus-line-inset"
    >
      {label}
    </button>
  );
}
