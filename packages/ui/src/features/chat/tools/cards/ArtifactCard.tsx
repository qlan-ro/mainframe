'use client';

/**
 * ArtifactCard — Claude's `Artifact` tool call, reduced to what the user needs:
 * what happened to which artifact, and a way to open it.
 *
 * Family: publish. Header: glyph + verb + title + StatusDot; the actions sit in the
 * header accessory so their clicks never toggle the card. Open shows the artifact
 * in the workspace; the arrow always goes to claude.ai. A publish that finishes
 * while the card is mounted updates any tab already showing that artifact.
 * Body: errors, and the listing actions' text. Publish results stay hidden; see
 * artifact-call.ts.
 */
import { useEffect, useRef } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ExternalLinkIcon, LayersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { refreshArtifactTabs } from '@/features/artifacts/refresh-artifact-tabs';
import { useOpenArtifact } from '@/features/artifacts/use-open-artifact';
import { useHost } from '@/lib/host';
import { StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';
import { describeArtifactCall } from './artifact-call';

function OpenActions({ url }: { url: string }) {
  const host = useHost();
  const { open, opening } = useOpenArtifact();

  const openExternal = () => {
    host.shell.openExternal(url).catch(() => {
      console.warn('[ArtifactCard] openExternal failed', url);
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={opening}
        data-testid="artifact-card-open"
        onClick={() => void open(url)}
      >
        {opening ? 'Opening…' : 'Open'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Open on claude.ai"
        data-testid="artifact-card-open-browser"
        onClick={openExternal}
      >
        <ExternalLinkIcon />
      </Button>
    </>
  );
}

export const ArtifactCard: ToolCallMessagePartComponent = ({ args, result, isError }) => {
  const { text: resultText } = resolveResultText(result);
  const call = describeArtifactCall(args, resultText);
  const url = result !== undefined && !isError ? call.url : null;

  // Only a call seen in flight refreshes: reloading a transcript mounts finished
  // cards, and those publishes are old news.
  const wasRunning = useRef(result === undefined);
  useEffect(() => {
    if (result === undefined) return;
    if (wasRunning.current && call.publishes && url !== null) void refreshArtifactTabs(url);
    wasRunning.current = false;
  }, [result, call.publishes, url]);
  const showBody = Boolean(resultText) && (Boolean(isError) || call.showResult);

  return (
    <CollapsibleCardShell
      testId="artifact-card-root"
      triggerId="artifact-card-trigger"
      result={result}
      isError={isError}
      defaultOpen={Boolean(isError)}
      icon={<LayersIcon />}
      verb={call.verb}
      target={call.label ? <span className="text-sm text-muted-foreground">{call.label}</span> : undefined}
      trailing={<StatusDot result={result} isError={isError} />}
      headerAccessory={url !== null ? <OpenActions url={url} /> : undefined}
    >
      {showBody && (
        <div className="border-t border-border">
          {isError ? (
            <ErrorBody text={resultText} testId="artifact-card-error-body" />
          ) : (
            <p
              data-testid="artifact-card-result"
              className="px-3 py-2 font-mono text-xs leading-normal wrap-break-word whitespace-pre-wrap text-muted-foreground"
            >
              {resultText}
            </p>
          )}
        </div>
      )}
    </CollapsibleCardShell>
  );
};

ArtifactCard.displayName = 'ArtifactCard';
