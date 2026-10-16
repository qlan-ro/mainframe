import { useEffect, useRef } from 'react';

interface ProviderCliOutputProps {
  adapterId: string;
  output: string;
}

/**
 * Scrollable monospace tail of the update command's stdout+stderr (already
 * ANSI-stripped by the daemon). Auto-scrolls to the bottom as `output` grows,
 * mirroring a live terminal tail — the point while an update is running.
 */
export function ProviderCliOutput({ adapterId, output }: ProviderCliOutputProps) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <pre
      ref={ref}
      data-testid={`settings-${adapterId}-cli-output`}
      className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground"
    >
      {output}
    </pre>
  );
}
