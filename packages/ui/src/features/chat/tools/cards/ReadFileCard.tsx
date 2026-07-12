/**
 * ReadFileCard — compact collapsible card for the 'Read' tool.
 *
 * Family: Explore. Collapsed by default.
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

const FAMILY_COLOR = 'var(--mf-tool-read)';
const FAMILY_BG = 'var(--mf-tool-read-tint)';

// ---------------------------------------------------------------------------
// CodePreview — the Read output verbatim
// ---------------------------------------------------------------------------

interface CodePreviewProps {
  text: string;
}

/**
 * Render the Read tool output as-is. It already arrives in `cat -n` format (each
 * line prefixed with its own line number), so we add no gutter of our own — that
 * would just double the numbers.
 */
function CodePreview({ text }: CodePreviewProps) {
  return (
    <pre
      data-testid="read-card-code-preview"
      className="bg-mf-code-bg font-mono text-label leading-normal text-mf-code-fg overflow-x-auto whitespace-pre px-3 py-2"
    >
      {text}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// ReadFileCard
// ---------------------------------------------------------------------------

export const ReadFileCard: ToolCallMessagePartComponent = ({ toolCallId, args, result, isError }) => {
  const chatId = useChatId();
  const filePath = typeof args['file_path'] === 'string' ? args['file_path'] : '';

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
      {metaLabel && <span className="shrink-0 font-mono text-caption text-mf-text-3">{metaLabel}</span>}
      <StatusDot result={result} isError={isError} />
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
        <CodePreview text={resultText} />
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
