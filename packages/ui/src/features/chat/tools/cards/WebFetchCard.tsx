'use client';

/**
 * WebFetchCard — compact collapsible card shared by Claude's 'WebFetch'/'WebSearch'
 * and Codex's normalized webSearch item (todo #356).
 *
 * Family: Web. Collapsed by default.
 * Verb and target derive from ARGS, not toolName, so a new vendor spelling
 * needs no card change: a `url` arg means Fetch, a `query` arg means Search,
 * and neither means a degraded card whose body, if any, is result text alone
 * (never raw JSON) — e.g. the error message from a malformed-args call.
 * Header: globe glyph + verb + target
 *   (Fetch: clickable url, opened via the host shell bridge; Search: quoted
 *   query, matching SearchCard's pattern; degraded: muted "No target") + StatusDot.
 * Body: url row (Fetch only) + a summary paragraph built from the result
 *   text — the CLI's opaque string result, no structured shape to parse.
 *   Codex's fetch carries no result text, so the body is the url row alone.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { GlobeIcon } from 'lucide-react';
import { useHost } from '@/lib/host';
import { StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';

// ---------------------------------------------------------------------------
// Operation + verb — derived from args, with a toolName fallback only for the
// degraded (neither url nor query) case, where args give no signal at all.
// ---------------------------------------------------------------------------

type Operation = 'fetch' | 'search' | 'none';

function verbFor(operation: Operation, toolName: string): string {
  if (operation === 'fetch') return 'Fetch';
  if (operation === 'search') return 'Search';
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
  const operation: Operation = url ? 'fetch' : query ? 'search' : 'none';

  const { text: resultText } = resolveResultText(result);
  const hasBody = Boolean(url) || Boolean(resultText);
  const verb = verbFor(operation, toolName);

  const target =
    operation === 'search' ? (
      <span className="min-w-0 truncate font-mono text-sm text-muted-foreground">&quot;{query}&quot;</span>
    ) : operation === 'none' ? (
      <span data-testid="web-fetch-card-no-target" className="text-sm text-muted-foreground">
        No target
      </span>
    ) : undefined;

  const trailing = <StatusDot result={result} isError={isError} />;

  const body = hasBody ? (
    <div className="border-t border-border">
      {isError ? (
        <ErrorBody text={resultText} testId="web-fetch-card-error-body" />
      ) : (
        <>
          {operation === 'fetch' && url && <UrlRow url={url} />}
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
