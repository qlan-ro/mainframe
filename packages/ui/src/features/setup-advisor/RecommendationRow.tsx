/**
 * One recommendation row: title, signal chip + why, a payload strip, and the
 * row's own copy/copy-failure transient state. The strip must never let the
 * clipboard surprise the user, so it says what the copy hands them: a file
 * payload (`targetPath` set) names its destination rather than showing the
 * first line of a JSON or Markdown body, and a command that spans lines says
 * how many are hidden behind the truncated preview. A `third-party` rule
 * renders its source repo + install count in a visually distinct
 * (warning-toned) chip — the design gate's condition for shipping aggregator
 * sources; first-party/vendor-official get a plain attribution line instead so
 * third-party never blends in.
 */
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <p className="mt-1">
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-xs text-warning">
          Third-party · {label}
        </Badge>
      </p>
    );
  }
  return <p className="mt-1 text-xs text-muted-foreground">{label}</p>;
}

function PayloadPreview({ rec }: { rec: AutomationRecommendation }) {
  if (rec.targetPath) {
    return (
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        Paste into <span className="select-text font-mono text-foreground">{rec.targetPath}</span>
      </span>
    );
  }

  const lines = rec.command.split('\n');
  const hidden = lines.length - 1;
  return (
    <>
      <span className="min-w-0 select-text truncate font-mono text-xs">{lines[0] ?? rec.command}</span>
      {hidden > 0 && (
        <span className="flex-shrink-0 text-xs text-muted-foreground">
          +{hidden} more {hidden === 1 ? 'line' : 'lines'}
        </span>
      )}
    </>
  );
}

export function RecommendationRow({ rec, copied, onCopied }: RecommendationRowProps) {
  const [failed, setFailed] = useState(false);

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
      <p className="font-medium text-foreground">{rec.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <Badge variant="secondary" className="px-1.5 py-0 font-mono text-xs font-normal">
          {rec.signal}
        </Badge>
        {` ${EM_DASH} ${rec.why}`}
      </p>
      <SourceAttribution rec={rec} />
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
        <PayloadPreview rec={rec} />
        <Button
          variant="outline"
          size="sm"
          data-testid={`automation-recommender-copy-${rec.id}`}
          onClick={() => void handleCopy()}
          className={cn('ml-auto h-7 shrink-0', copied && !failed && 'border-transparent bg-success/10 text-success')}
        >
          {failed ? 'Copy failed' : copied ? <CopiedLabel /> : <CopyLabel />}
        </Button>
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
