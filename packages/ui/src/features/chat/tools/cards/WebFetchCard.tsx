'use client';

/**
 * WebFetchCard — compact collapsible card for the 'WebFetch' and 'WebSearch' tools.
 *
 * Family: Web. Collapsed by default.
 * Header: family tile (globe icon) + verb ("Fetch"/"Search") + target
 *   (WebFetch: clickable url, opened via the host shell bridge; WebSearch:
 *   quoted query, matching SearchCard's pattern) + StatusDot.
 * Body: url row (WebFetch only) + a summary paragraph built from the result
 *   text — the CLI's opaque string result, no structured shape to parse.
 *
 * Family color: dedicated teal token (09-toolcards.jsx TOOL_META.web,
 * #16a394), mirroring the --mf-tool-read/-search/-bash pattern.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { GlobeIcon } from 'lucide-react';
import { useHost } from '@/lib/host';
import { StatusDot, CollapsibleCardShell, FamilyTile, ErrorBody, resolveResultText } from '../shared';

// ---------------------------------------------------------------------------
// Family color (matches 09-toolcards.jsx TOOL_META.web)
// ---------------------------------------------------------------------------

const FAMILY_COLOR = 'var(--mf-tool-web)';
const FAMILY_BG = 'var(--mf-tool-web-tint)';

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
    <div className="flex items-center gap-[7px] px-3 pt-2">
      <GlobeIcon size={12} className="text-mf-text-3 shrink-0" />
      <button
        type="button"
        data-testid="web-fetch-card-url"
        onClick={open}
        className="font-mono text-caption text-primary truncate min-w-0 hover:underline cursor-pointer text-left"
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
    <p data-testid="web-fetch-card-summary" className="px-3 pb-2 pt-1.5 text-label text-mf-text-2 leading-normal">
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

  const tile = (
    <FamilyTile color={FAMILY_COLOR} bg={FAMILY_BG}>
      <GlobeIcon size={13} style={{ color: FAMILY_COLOR }} />
    </FamilyTile>
  );

  const target = isSearch && query ? (
    <span className="font-mono text-caption text-muted-foreground min-w-0 truncate">&quot;{query}&quot;</span>
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
      tile={tile}
      verb={verb}
      target={target}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

WebFetchCard.displayName = 'WebFetchCard';
