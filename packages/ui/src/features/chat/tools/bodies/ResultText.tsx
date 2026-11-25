/** A call's result as text: one the daemon cut short offers the whole of it. */
import type { ReactNode } from 'react';
import { resolveResultText } from '../shared';
import { useChatId } from '../chat-tool-context';
import { ToolResultExpand } from '../ToolResultExpand';
import type { ToolPart } from '../../view-model/turn/types';
import { KeyValue, Surface } from './Surface';

/** The text alone, where a surface already holds it. */
export function ResultText({ part, renderOutput }: { part: ToolPart; renderOutput?: (text: string) => ReactNode }) {
  const chatId = useChatId();
  const { text, truncated, fullBytes } = resolveResultText(part.result, Boolean(renderOutput));
  if (truncated && chatId)
    return (
      <ToolResultExpand
        chatId={chatId}
        toolUseId={part.toolCallId}
        truncatedContent={text}
        fullBytes={fullBytes}
        renderOutput={renderOutput}
      />
    );
  return renderOutput?.(text) ?? <pre className="wrap-break-word whitespace-pre-wrap">{text}</pre>;
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
