/**
 * SearchCard — compact collapsible card for 'Glob', 'Grep', and 'LS' tools.
 *
 * Family: Search. One component, switches on part.toolName.
 * Header: family glyph + tool verb + quoted pattern/glob + optional "in {path}" sub-header.
 * Body (collapsed by default): plain match-list pre or ErrorBody.
 *   - TruncatedResult → ToolResultExpand.
 *   - All string/JSON results → pre listing (the daemon never returns a
 *     structured GrepMatch array — that dead path has been removed).
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { SearchIcon } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Verb by tool name
// ---------------------------------------------------------------------------

function verbFor(toolName: string): string {
  if (toolName === 'Grep') return 'Search';
  if (toolName === 'LS') return 'List';
  return 'Glob';
}

// ---------------------------------------------------------------------------
// PlainBody — pre for plain search results
// ---------------------------------------------------------------------------

function PlainBody({ resultText }: { resultText: string }) {
  return (
    <pre
      data-testid="search-card-plain-body"
      className="px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap text-muted-foreground"
    >
      {resultText}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// SearchCard
// ---------------------------------------------------------------------------

export const SearchCard: ToolCallMessagePartComponent = ({ toolName, toolCallId, args, result, isError }) => {
  const chatId = useChatId();

  const pattern =
    typeof args['pattern'] === 'string'
      ? args['pattern']
      : typeof args['glob'] === 'string'
        ? args['glob']
        : typeof args['path'] === 'string'
          ? args['path']
          : '';
  const searchPath = typeof args['path'] === 'string' ? args['path'] : '';

  const { text: resultText, truncated, fullBytes } = resolveResultText(result);
  const hasBody = Boolean(resultText);
  const verb = verbFor(toolName);

  const matchCount = resultText ? resultText.split('\n').filter(Boolean).length : null;

  const patternTarget = pattern ? (
    <TruncatedWithTooltip
      text={`"${pattern}"`}
      className="min-w-0 max-w-[200px] font-mono text-sm text-muted-foreground"
      contentClassName="font-mono break-all"
    />
  ) : null;

  const trailing = (
    <>
      {matchCount !== null && <span className="shrink-0 font-mono text-xs text-muted-foreground">· {matchCount}</span>}
      <StatusDot result={result} isError={isError} />
    </>
  );

  const subHeader = searchPath ? (
    <div className="px-3 pb-1.5 pl-[calc(0.75rem+0.875rem+0.5rem)]">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="search-card-path"
            className="block cursor-default truncate font-mono text-xs text-muted-foreground"
            tabIndex={0}
          >
            in {searchPath}
          </span>
        </TooltipTrigger>
        <TooltipContent>{searchPath}</TooltipContent>
      </Tooltip>
    </div>
  ) : null;

  const body = hasBody ? (
    <div className="border-t border-border py-1.5">
      {truncated && chatId ? (
        <div className="px-3 py-1">
          <ToolResultExpand
            chatId={chatId}
            toolUseId={toolCallId}
            truncatedContent={resultText}
            fullBytes={fullBytes}
          />
        </div>
      ) : isError ? (
        <ErrorBody text={resultText} testId="search-card-error-body" />
      ) : (
        <PlainBody resultText={resultText} />
      )}
    </div>
  ) : null;

  return (
    <CollapsibleCardShell
      testId="search-card-root"
      triggerId="search-card-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      disableTrigger={!hasBody}
      icon={<SearchIcon />}
      verb={verb}
      target={patternTarget}
      trailing={trailing}
      subHeader={subHeader}
    >
      {body}
    </CollapsibleCardShell>
  );
};

SearchCard.displayName = 'SearchCard';
