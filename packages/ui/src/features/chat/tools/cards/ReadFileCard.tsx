/**
 * ReadFileCard — compact collapsible card for the 'Read' tool.
 *
 * Family: Explore. Collapsed by default.
 * Header: file glyph + "Read" verb + ClickableFilePath + optional "· N lines" meta.
 * Body: the Read output verbatim on the code palette.
 *   - Truncated results → ToolResultExpand (full fetch on demand).
 *   - Error results → shared ErrorBody.
 *   - No result yet → body absent (pending state shown via StatusDot).
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { FileTextIcon } from 'lucide-react';
import { ClickableFilePath, StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';
import { ToolResultExpand } from '../ToolResultExpand';
import { useChatId } from '../chat-tool-context';

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
      className="overflow-x-auto bg-mf-code-bg px-3 py-2 font-mono text-xs leading-normal text-mf-code-fg"
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

  const trailing = (
    <>
      {metaLabel && <span className="shrink-0 font-mono text-xs text-muted-foreground">{metaLabel}</span>}
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
      icon={<FileTextIcon />}
      verb="Read"
      target={filePath ? <ClickableFilePath filePath={filePath} /> : undefined}
      trailing={trailing}
    >
      {body}
    </CollapsibleCardShell>
  );
};

ReadFileCard.displayName = 'ReadFileCard';
