/**
 * One recommendation row: title, signal chip + why, a command row (first
 * line only — a multi-line `command` is a config snippet, copy still writes
 * every line), and the row's own copy/copy-failure transient state. A
 * `third-party` rule renders its source repo + install count in a visually
 * distinct (warning-toned) chip — the design gate's condition for shipping
 * aggregator sources; first-party/vendor-official get a plain attribution
 * line instead so third-party never blends in.
 */
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationRecommendation } from '@qlan-ro/mainframe-types';
import { copyCommand } from './copy-command';

const EM_DASH = '—';
const COPY_FAILED_REVERT_MS = 1500;

interface RecommendationRowProps {
  rec: AutomationRecommendation;
  copied: boolean;
  onCopied: () => void;
}

function SourceAttribution({ rec }: { rec: AutomationRecommendation }) {
  if (!rec.source) return null;
  const label = `${rec.source.repo} · ${rec.source.installs.toLocaleString()} installs`;
  if (rec.provenance === 'third-party') {
    return (
      <p className="mt-1 inline-flex items-center rounded-full border border-mf-warning/40 bg-mf-warning-tint px-2 py-0.5 text-caption text-mf-warning">
        Third-party · {label}
      </p>
    );
  }
  return <p className="mt-1 text-caption text-muted-foreground">{label}</p>;
}

export function RecommendationRow({ rec, copied, onCopied }: RecommendationRowProps) {
  const [failed, setFailed] = useState(false);
  const firstLine = rec.command.split('\n')[0];

  async function handleCopy() {
    try {
      await copyCommand(rec.command);
      setFailed(false);
      onCopied();
    } catch {
      setFailed(true);
      setTimeout(() => setFailed(false), COPY_FAILED_REVERT_MS);
    }
  }

  return (
    <div className="px-4 py-3">
      <p className="text-body font-medium text-foreground">{rec.title}</p>
      <p className="mt-1 text-caption text-muted-foreground">
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption">{rec.signal}</span>
        {` ${EM_DASH} ${rec.why}`}
      </p>
      <SourceAttribution rec={rec} />
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
        <span className="select-text truncate font-mono text-caption">{firstLine}</span>
        <button
          type="button"
          data-testid={`automation-recommender-copy-${rec.id}`}
          onClick={() => void handleCopy()}
          className={cn(
            'ml-auto flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-caption',
            copied && !failed ? 'border-transparent bg-mf-success-tint text-mf-success' : 'text-muted-foreground',
          )}
        >
          {failed ? 'Copy failed' : copied ? <CopiedLabel /> : <CopyLabel />}
        </button>
      </div>
    </div>
  );
}

function CopiedLabel() {
  return (
    <>
      <Check size={12} /> Copied
    </>
  );
}

function CopyLabel() {
  return (
    <>
      <Copy size={12} /> Copy
    </>
  );
}
