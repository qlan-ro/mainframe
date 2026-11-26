/** A call's result as text: one the daemon cut short offers the whole of it. */
import type { ReactNode } from 'react';
import { resolveResultText, stripErrorXml } from '../shared';
import { useChatId } from '../chat-tool-context';
import { useTranscriptScope } from '../../messages/turn/transcript-scope';
import { ToolResultExpand } from '../ToolResultExpand';
import type { ToolPart } from '../../view-model/turn/types';
import { KeyValue, Surface } from './Surface';

const cleanPreservingWhitespace = (text: string) => stripErrorXml(text, false);

/** The text alone, where a surface already holds it. */
export function ResultText({
  part,
  renderPreview,
  preserveText,
}: {
  part: ToolPart;
  renderPreview?: (content: string) => ReactNode;
  preserveText?: boolean;
}) {
  const chatId = useChatId();
  const { subagentId } = useTranscriptScope();
  const { text, truncated, fullBytes } = resolveResultText(
    part.result,
    preserveText ? cleanPreservingWhitespace : undefined,
  );
  if (truncated && chatId)
    return (
      <ToolResultExpand
        chatId={chatId}
        toolUseId={part.toolCallId}
        agentId={subagentId}
        truncatedContent={text}
        fullBytes={fullBytes}
        renderPreview={renderPreview}
      />
    );
  return renderPreview ? renderPreview(text) : <pre className="whitespace-pre">{text}</pre>;
}

export function ResultBlock({
  part,
  failed,
  testId,
  renderPreview,
  preserveText,
}: {
  part: ToolPart;
  failed: boolean;
  testId: string;
  renderPreview?: (content: string) => ReactNode;
  preserveText?: boolean;
}) {
  return (
    <Surface className="max-h-96 overflow-y-auto">
      <KeyValue
        label={failed ? 'Error' : 'Result'}
        hideLabel={renderPreview != null}
        tone={failed ? 'fail' : undefined}
        testId={testId}
      >
        <ResultText part={part} renderPreview={renderPreview} preserveText={preserveText} />
      </KeyValue>
    </Surface>
  );
}
