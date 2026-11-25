/** A call's result as text: one the daemon cut short offers the whole of it. */
import type { ReactNode } from 'react';
import { resolveResultText } from '../shared';
import { useChatId } from '../chat-tool-context';
import { ToolResultExpand } from '../ToolResultExpand';
import type { ToolPart } from '../../view-model/turn/types';
import { KeyValue, Surface } from './Surface';

/** The text alone, where a surface already holds it. */
export function ResultText({
  part,
  renderPreview,
}: {
  part: ToolPart;
  renderPreview?: (content: string) => ReactNode;
}) {
  const chatId = useChatId();
  const { text, truncated, fullBytes } = resolveResultText(part.result);
  if (truncated && chatId)
    return (
      <ToolResultExpand
        chatId={chatId}
        toolUseId={part.toolCallId}
        truncatedContent={text}
        fullBytes={fullBytes}
        renderPreview={renderPreview}
      />
    );
  return renderPreview ? renderPreview(text) : <pre className="whitespace-pre">{text}</pre>;
}

export function ResultBlock({ part, failed, testId }: { part: ToolPart; failed: boolean; testId: string }) {
  return (
    <Surface className="max-h-96 overflow-y-auto">
      <KeyValue label={failed ? 'Error' : 'Result'} tone={failed ? 'fail' : undefined} testId={testId}>
        <ResultText part={part} />
      </KeyValue>
    </Surface>
  );
}
