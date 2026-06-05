/**
 * ReadFileCard — compact collapsible card for the 'Read' tool.
 *
 * Family: Explore (blue #5b8def). Collapsed by default.
 * Header: file-type tile + "Read" verb + ClickableFilePath + optional "· N lines" meta.
 * Body: line-numbered code preview on bg-mf-code-bg.
 *   - Truncated results → ToolResultExpand (full fetch on demand).
 *   - Error results → shared ErrorBody.
 *   - No result yet → body absent (pending state shown via StatusDot).
 *
 * Token rules: no /opacity modifier on --mf-* hex vars.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { FileTextIcon } from 'lucide-react';
import {
  ClickableFilePath,
  StatusDot,
  CollapsibleCardShell,
  FamilyTile,
  ErrorBody,
  resolveResultText,
} from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

// ---------------------------------------------------------------------------
// Family constants
// ---------------------------------------------------------------------------

const FAMILY_COLOR = '#5b8def';
const FAMILY_BG = `${FAMILY_COLOR}1c`; // ~11% alpha tint

// ---------------------------------------------------------------------------
// CodePreview — line-numbered plain text view
// ---------------------------------------------------------------------------

interface CodePreviewProps {
  text: string;
  startLine: number;
}

function CodePreview({ text, startLine }: CodePreviewProps) {
  const lines = text.split('\n');
  return (
    <div
      data-testid="read-card-code-preview"
      className="bg-mf-code-bg font-mono text-caption leading-[18px] overflow-x-auto max-h-[300px] overflow-y-auto"
    >
      {lines.map((line, i) => (
        <div key={i} className="flex min-h-[18px] hover:bg-muted transition-colors">
          <span className="shrink-0 w-9 text-right pr-3 select-none text-mf-text-4 text-micro leading-[18px]">
            {startLine + i}
          </span>
          <span className="flex-1 whitespace-pre pr-3 text-mf-code-fg">{line}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadFileCard
// ---------------------------------------------------------------------------

export const ReadFileCard: ToolCallMessagePartComponent = ({ toolCallId, args, result, isError }) => {
  const chatId = useChatId();
  const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';
  const fromLine = typeof args['from'] === 'number' ? args['from'] : 1;

  const { text: resultText, truncated, fullBytes } = resolveResultText(result);

  const lineCount = resultText ? resultText.split('\n').length : 0;
  const metaLabel = lineCount > 0 ? `· ${lineCount} line${lineCount !== 1 ? 's' : ''}` : undefined;
  const hasBody = Boolean(resultText);

  const tile = (
    <FamilyTile color={FAMILY_COLOR} bg={FAMILY_BG}>
      <FileTextIcon size={13} style={{ color: FAMILY_COLOR }} />
    </FamilyTile>
  );

  const trailing = (
    <>
      {metaLabel && <span className="shrink-0 font-mono text-micro text-mf-text-4">{metaLabel}</span>}
      <StatusDot result={result} isError={isError} label />
    </>
  );

  const body = hasBody ? (
    <div className="border-t border-border">
      {truncated && chatId ? (
        <div className="px-3 py-2">
          <ToolResultExpand
            chatId={chatId}
            toolUseId={toolCallId}
            truncatedContent={resultText}
            fullBytes={fullBytes}
          />
        </div>
      ) : isError ? (
        <ErrorBody text={resultText} testId="read-card-error-body" />
      ) : (
        <CodePreview text={resultText} startLine={fromLine} />
      )}
    </div>
  ) : null;

  return (
    <CollapsibleCardShell
      testId="read-card-root"
      triggerId="read-card-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      disableTrigger={!hasBody}
      tile={tile}
      verb="Read"
      target={filePath ? <ClickableFilePath filePath={filePath} /> : undefined}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

ReadFileCard.displayName = 'ReadFileCard';
