/**
 * SearchCard — compact collapsible card for 'Glob', 'Grep', and 'LS' tools.
 *
 * Family: Search. One component, switches on part.toolName.
 * Header: family tile + tool verb + quoted pattern/glob + optional "in {path}" sub-header.
 * Body (collapsed by default): plain match-list pre or ErrorBody.
 *   - TruncatedResult → ToolResultExpand.
 *   - All string/JSON results → pre listing (the daemon never returns a
 *     structured GrepMatch array — that dead path has been removed).
 *
 * Token rules: no /opacity modifier on --mf-* hex vars.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { SearchIcon } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { StatusDot, CollapsibleCardShell, FamilyTile, ErrorBody, resolveResultText } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Family constants
// ---------------------------------------------------------------------------

const FAMILY_COLOR = 'var(--mf-tool-search)';
const FAMILY_BG = 'var(--mf-tool-search-tint)';

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
      className="font-mono text-caption whitespace-pre-wrap break-words px-3 py-2 text-muted-foreground"
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

  const tile = (
    <FamilyTile color={FAMILY_COLOR} bg={FAMILY_BG}>
      <SearchIcon size={13} style={{ color: FAMILY_COLOR }} />
    </FamilyTile>
  );

  const patternTarget = pattern ? (
    <>
      <span className="text-mf-text-4 shrink-0">·</span>
      <TruncatedWithTooltip
        text={`"${pattern}"`}
        className="font-mono text-caption text-muted-foreground min-w-0 max-w-[200px]"
        contentClassName="font-mono break-all"
      />
    </>
  ) : null;

  const trailing = (
    <>
      {matchCount !== null && <span className="font-mono text-micro text-mf-text-3 shrink-0">· {matchCount}</span>}
      <StatusDot result={result} isError={isError} />
    </>
  );

  const subHeader = searchPath ? (
    <div className="px-2.5 pb-1 pl-[38px]">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid="search-card-path"
            className="font-mono text-micro text-mf-text-4 truncate block cursor-default"
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
      tile={tile}
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
