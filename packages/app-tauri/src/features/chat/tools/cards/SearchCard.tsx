/**
 * SearchCard — compact collapsible card for 'Glob', 'Grep', and 'LS' tools.
 *
 * Family: Search (purple, #9b59c4). One component, switches on part.toolName.
 * Header: family tile + tool verb + quoted pattern/glob + optional "in {path}" sub-header.
 * Body (collapsed by default):
 *   - Grep structured output → clickable match rows (file + :line + text).
 *   - TruncatedResult → ToolResultExpand.
 *   - Other string/JSON → pre listing.
 *   - isError → destructive-tinted pre.
 *
 * Token rules: no /opacity modifier on --mf-* hex vars.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { SearchIcon } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StatusDot, cardStyle, isTruncatedResult, stripErrorXml, shortFilename } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId, useOpenFile } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Family constants
// ---------------------------------------------------------------------------

const FAMILY_COLOR = '#9b59c4';
const FAMILY_BG = `${FAMILY_COLOR}1c`;

// ---------------------------------------------------------------------------
// Verb by tool name
// ---------------------------------------------------------------------------

function verbFor(toolName: string): string {
  if (toolName === 'Grep') return 'Grep';
  if (toolName === 'LS') return 'List';
  return 'Glob';
}

// ---------------------------------------------------------------------------
// Grep match row (structured result)
// ---------------------------------------------------------------------------

interface GrepMatch {
  file: string;
  line?: number;
  text?: string;
}

function isGrepMatchArray(v: unknown): v is GrepMatch[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    typeof (v as unknown[])[0] === 'object' &&
    (v as unknown[])[0] !== null &&
    'file' in ((v as unknown[])[0] as object)
  );
}

interface GrepMatchRowProps {
  match: GrepMatch;
  onOpen: (path: string) => void;
}

function GrepMatchRow({ match, onOpen }: GrepMatchRowProps) {
  const handleClick = () => onOpen(match.file);
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(match.file);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="search-card-match-row"
      className="flex items-baseline gap-2.5 px-3 py-0.5 cursor-pointer font-mono text-caption hover:bg-accent transition-colors"
      onClick={handleClick}
      onKeyDown={handleKey}
    >
      <span className="shrink-0 text-mf-code-fn truncate max-w-[240px]" title={match.file}>
        {shortFilename(match.file)}
      </span>
      {match.line !== undefined && <span className="shrink-0 text-mf-text-4">:{match.line}</span>}
      {match.text && (
        <span className="text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {match.text}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result body variants
// ---------------------------------------------------------------------------

interface BodyProps {
  resultText: string;
  isError: boolean | undefined;
}

function PlainBody({ resultText, isError }: BodyProps) {
  if (isError) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-destructive opacity-10 pointer-events-none" aria-hidden />
        <pre
          data-testid="search-card-error-body"
          className="relative font-mono text-caption whitespace-pre-wrap break-words px-3 py-2 max-h-[300px] overflow-y-auto text-destructive"
        >
          {resultText}
        </pre>
      </div>
    );
  }
  return (
    <pre
      data-testid="search-card-plain-body"
      className="font-mono text-caption whitespace-pre-wrap break-words px-3 py-2 max-h-[300px] overflow-y-auto text-muted-foreground"
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
  const { openFile } = useOpenFile();

  const pattern =
    typeof args['pattern'] === 'string'
      ? args['pattern']
      : typeof args['glob'] === 'string'
        ? args['glob']
        : typeof args['path'] === 'string'
          ? args['path']
          : '';
  const searchPath = typeof args['path'] === 'string' ? args['path'] : '';

  const truncated = isTruncatedResult(result);

  // Determine raw text for display
  const rawText =
    typeof result === 'string'
      ? result
      : truncated
        ? result.content
        : result !== undefined
          ? JSON.stringify(result, null, 2)
          : undefined;
  const resultText = rawText ? stripErrorXml(rawText) : undefined;

  // Try to parse structured grep results when toolName is Grep
  let grepMatches: GrepMatch[] | null = null;
  if (toolName === 'Grep' && typeof result === 'string') {
    try {
      const parsed: unknown = JSON.parse(result);
      if (isGrepMatchArray(parsed)) grepMatches = parsed;
    } catch {
      // Not JSON — fall through to plain text rendering
    }
  } else if (toolName === 'Grep' && isGrepMatchArray(result)) {
    grepMatches = result;
  }

  const hasBody = resultText !== undefined;
  const verb = verbFor(toolName);

  return (
    <Collapsible
      data-testid="search-card-root"
      defaultOpen={false}
      className={cn(cardStyle(result, isError), 'w-full')}
    >
      {/* Header */}
      <CollapsibleTrigger
        data-testid="search-card-trigger"
        disabled={!hasBody}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-1.5',
          'text-body transition-colors hover:bg-accent',
          !hasBody && 'cursor-default',
        )}
      >
        <span
          aria-hidden
          className="flex shrink-0 items-center justify-center w-[22px] h-[22px] rounded-md"
          style={{ backgroundColor: FAMILY_BG }}
        >
          <SearchIcon size={13} style={{ color: FAMILY_COLOR }} />
        </span>

        <span className="text-label font-semibold text-muted-foreground shrink-0">{verb}</span>

        {pattern && (
          <>
            <span className="text-mf-text-4 shrink-0">·</span>
            <code
              className="font-mono text-caption text-muted-foreground truncate min-w-0 max-w-[200px]"
              title={pattern}
            >
              &quot;{pattern}&quot;
            </code>
          </>
        )}

        <div className="flex-1 min-w-2" />
        <StatusDot result={result} isError={isError} />
      </CollapsibleTrigger>

      {/* Sub-header: search path */}
      {searchPath && (
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
      )}

      {/* Body */}
      {hasBody && (
        <CollapsibleContent
          data-testid="search-card-content"
          className={cn(
            'overflow-hidden',
            'data-[state=open]:animate-collapsible-down',
            'data-[state=closed]:animate-collapsible-up',
            'data-[state=closed]:fill-mode-forwards',
          )}
        >
          <div className="border-t border-border py-1.5">
            {truncated && chatId ? (
              <div className="px-3 py-1">
                <ToolResultExpand
                  chatId={chatId}
                  toolUseId={toolCallId}
                  truncatedContent={resultText ?? ''}
                  fullBytes={result.fullBytes}
                />
              </div>
            ) : grepMatches ? (
              <div data-testid="search-card-grep-matches">
                {grepMatches.map((m, i) => (
                  <GrepMatchRow key={`${m.file}-${m.line ?? i}`} match={m} onOpen={openFile} />
                ))}
              </div>
            ) : (
              <PlainBody resultText={resultText ?? ''} isError={isError} />
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
};

SearchCard.displayName = 'SearchCard';
