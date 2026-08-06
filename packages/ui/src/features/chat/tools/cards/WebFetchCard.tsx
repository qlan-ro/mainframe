'use client';

/**
 * WebFetchCard — compact collapsible card for the 'WebFetch' and 'WebSearch' tools.
 *
 * Family: Web. Collapsed by default.
 * Header: globe glyph + verb ("Fetch"/"Search") + target
 *   (WebFetch: clickable url, opened via the host shell bridge; WebSearch:
 *   quoted query, matching SearchCard's pattern) + StatusDot.
 * Body: url row (WebFetch only) + a summary paragraph built from the result
 *   text — the CLI's opaque string result, no structured shape to parse.
 *
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { GlobeIcon } from 'lucide-react';
import { useHost } from '@/lib/host';
import { StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';

// ---------------------------------------------------------------------------
// Verb by tool name
// ---------------------------------------------------------------------------

function verbFor(toolName: string): string {
  return toolName === 'WebSearch' ? 'Search' : 'Fetch';
}

// ---------------------------------------------------------------------------
// UrlRow — clickable url, opened via the host shell bridge
// ---------------------------------------------------------------------------

function UrlRow({ url }: { url: string }) {
  const host = useHost();

  const open = () => {
    host.shell.openExternal(url).catch(() => {
      console.warn('[WebFetchCard] openExternal failed', url);
    });
  };

  return (
    <div className="flex items-center gap-2 px-3 pt-2">
      <GlobeIcon className="size-3 shrink-0 text-muted-foreground" />
      <button
        type="button"
        data-testid="web-fetch-card-url"
        onClick={open}
        className="min-w-0 cursor-pointer truncate text-left font-mono text-xs text-primary underline-offset-4 hover:underline"
      >
        {url}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SummaryBody
// ---------------------------------------------------------------------------

function SummaryBody({ text }: { text: string }) {
  return (
    <p data-testid="web-fetch-card-summary" className="px-3 pt-1.5 pb-2 text-xs leading-normal text-muted-foreground">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// WebFetchCard
// ---------------------------------------------------------------------------

export const WebFetchCard: ToolCallMessagePartComponent = ({ toolName, args, result, isError }) => {
  const url = typeof args['url'] === 'string' ? args['url'] : '';
  const query = typeof args['query'] === 'string' ? args['query'] : '';
  const isSearch = toolName === 'WebSearch';

  const { text: resultText } = resolveResultText(result);
  const hasBody = Boolean(resultText) || (!isSearch && Boolean(url));
  const verb = verbFor(toolName);

  const target =
    isSearch && query ? (
      <span className="min-w-0 truncate font-mono text-sm text-muted-foreground">&quot;{query}&quot;</span>
    ) : undefined;

  const trailing = <StatusDot result={result} isError={isError} />;

  const body = hasBody ? (
    <div className="border-t border-border">
      {isError ? (
        <ErrorBody text={resultText} testId="web-fetch-card-error-body" />
      ) : (
        <>
          {!isSearch && url && <UrlRow url={url} />}
          {resultText && <SummaryBody text={resultText} />}
        </>
      )}
    </div>
  ) : null;

  return (
    <CollapsibleCardShell
      testId="web-fetch-card-root"
      triggerId="web-fetch-card-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      disableTrigger={!hasBody}
      icon={<GlobeIcon />}
      verb={verb}
      target={target}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

WebFetchCard.displayName = 'WebFetchCard';
