/**
 * FailureTail — the last lines the skills CLI printed before it failed.
 *
 * A toast is the wrong home for this: it auto-dismisses, and the tail is the
 * only thing that says *why*. It stays in the section until the next attempt
 * clears it, expanded by default and foldable once read. ANSI escapes are
 * stripped — the CLI colors its output even when its stdout is a pipe.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

interface FailureTailProps {
  message: string;
  tail?: string;
}

export function FailureTail({ message, tail }: FailureTailProps) {
  const [expanded, setExpanded] = useState(true);
  const clean = tail?.replace(ANSI, '').trim();

  return (
    <div className="flex flex-col gap-1 rounded-md border-[0.5px] border-destructive/30 bg-destructive/8 px-2 py-1.5">
      <p className="text-xs font-medium text-destructive">{message}</p>
      {clean ? (
        <>
          <button
            type="button"
            data-testid="skills-section-failure-tail-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            CLI output
          </button>
          {expanded ? (
            <pre
              data-testid="skills-section-failure-tail"
              className="max-h-[160px] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground"
            >
              {clean}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
