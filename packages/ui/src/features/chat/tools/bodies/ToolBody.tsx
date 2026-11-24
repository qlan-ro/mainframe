/** What a tool's row opens on, by kind. */
import { useChatId } from '../chat-tool-context';
import { ToolResultExpand } from '../ToolResultExpand';
import { ToolResultImageThumbs, resolveResultText, resultImages } from '../shared';
import { resolveToolDiff } from '../shared/diff-data';
import { argText, createsFile } from '../../view-model/turn/tool-values';
import { toolKind } from '../../view-model/turn/tool-kind';
import type { ToolPart, ToolStatus } from '../../view-model/turn/types';
import { record } from '../../view-model/turn/values';
import { BackgroundOutput } from './BackgroundOutput';
import { CodeBody } from './CodeBody';
import { DiffBody } from './DiffBody';
import { BodyNote, KeyValue, Surface } from './Surface';
import { TerminalBody } from './TerminalBody';
import { WebBody } from './WebBody';
import { parseCodeLines } from './code-lines';

export interface ToolBodyProps {
  part: ToolPart;
  status: ToolStatus;
}

const isBackground = (part: ToolPart) => record(part.args)?.run_in_background === true;

/** Whether the row has anything to open on. */
export function hasToolBody(part: ToolPart, status: ToolStatus): boolean {
  const { text } = resolveResultText(part.result);
  if (text || resultImages(part.result).length) return true;
  switch (toolKind(part.toolName)) {
    case 'edit':
      return resolveToolDiff('Edit', part.args, part.result).hunks !== null;
    case 'write':
      return Boolean(argText(part, 'content'));
    case 'shell':
      return isBackground(part) || status === 'success' || status === 'failed';
    case 'mcp':
    case 'unknown':
      return Object.keys(record(part.args) ?? {}).length > 0;
    default:
      return false;
  }
}

/** A result the daemon cut short, with the whole of it on request. */
function Truncated({ part, text, fullBytes }: { part: ToolPart; text: string; fullBytes: number }) {
  const chatId = useChatId();
  return (
    <Surface className="px-3 py-2">
      {chatId ? (
        <ToolResultExpand chatId={chatId} toolUseId={part.toolCallId} truncatedContent={text} fullBytes={fullBytes} />
      ) : (
        <pre className="wrap-break-word whitespace-pre-wrap">{text}</pre>
      )}
    </Surface>
  );
}

function ErrorBody({ text }: { text: string }) {
  return (
    <Surface>
      <KeyValue label="Error" tone="fail" testId="chat-tool-error">
        {text}
      </KeyValue>
    </Surface>
  );
}

function ChangeBody({ part }: { part: ToolPart }) {
  const kind = toolKind(part.toolName) === 'edit' ? 'Edit' : 'Write';
  const { hunks } = resolveToolDiff(kind, part.args, part.result);
  if (hunks?.length && !(kind === 'Write' && createsFile(part)))
    return <DiffBody id={part.toolCallId} hunks={hunks} testId="chat-edit-diff" />;
  const content = argText(part, 'content');
  if (content)
    return (
      <CodeBody
        id={part.toolCallId}
        path={argText(part, 'file_path')}
        lines={parseCodeLines(content)}
        testId="chat-write-code"
      />
    );
  const { text } = resolveResultText(part.result);
  return text ? (
    <Surface>
      <KeyValue label="Result" testId="chat-edit-raw">
        {text}
      </KeyValue>
    </Surface>
  ) : (
    <BodyNote testId="chat-edit-unavailable">Diff unavailable</BodyNote>
  );
}

function ShellBody({ part, status }: ToolBodyProps) {
  const { text, truncated, fullBytes } = resolveResultText(part.result);
  const command = argText(part, 'command') || argText(part, 'input');
  const description = argText(part, 'description');
  return (
    <>
      {description && <BodyNote testId="chat-bash-description">{description}</BodyNote>}
      {isBackground(part) ? (
        <BackgroundOutput toolCallId={part.toolCallId} command={command} launch={text} />
      ) : truncated ? (
        <Truncated part={part} text={text} fullBytes={fullBytes} />
      ) : (
        <TerminalBody command={command} output={text || (status === 'running' ? '' : '(no output)')} />
      )}
    </>
  );
}

function CallBody({ part, status }: ToolBodyProps) {
  const { text } = resolveResultText(part.result);
  const args = record(part.args) ?? {};
  return (
    <Surface testId="chat-call-body">
      {Object.keys(args).length > 0 && (
        <KeyValue label="Arguments" testId="chat-call-args">
          {JSON.stringify(args, null, 2)}
        </KeyValue>
      )}
      {text && (
        <KeyValue
          label={status === 'failed' ? 'Error' : 'Result'}
          tone={status === 'failed' ? 'fail' : undefined}
          testId="chat-call-result"
        >
          {text}
        </KeyValue>
      )}
    </Surface>
  );
}

function MainBody({ part, status }: ToolBodyProps) {
  const { text, truncated, fullBytes } = resolveResultText(part.result);
  const kind = toolKind(part.toolName);
  if (kind === 'shell') return <ShellBody part={part} status={status} />;
  if (kind === 'mcp' || kind === 'unknown') return <CallBody part={part} status={status} />;
  const error = status === 'failed' && text ? <ErrorBody text={text} /> : null;
  if (kind === 'edit' || kind === 'write')
    return (
      <>
        {status !== 'failed' && <ChangeBody part={part} />}
        {error}
      </>
    );
  if (error) return error;
  if (truncated) return <Truncated part={part} text={text} fullBytes={fullBytes} />;
  if (kind === 'fetch' || kind === 'web-search') return <WebBody url={argText(part, 'url') || undefined} text={text} />;
  if (!text) return null;
  if (kind === 'read')
    return (
      <CodeBody
        id={part.toolCallId}
        path={argText(part, 'file_path')}
        lines={parseCodeLines(text)}
        testId="read-card-code-preview"
      />
    );
  return (
    <Surface className="max-h-96 overflow-y-auto">
      <KeyValue label="Result" testId="search-card-plain-body">
        {text}
      </KeyValue>
    </Surface>
  );
}

export function ToolBody({ part, status }: ToolBodyProps) {
  const images = resultImages(part.result);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="min-w-0 empty:hidden">
        <MainBody part={part} status={status} />
      </div>
      {images.length > 0 && (
        <div data-testid="chat-tool-images">
          <ToolResultImageThumbs toolCallId={part.toolCallId} images={images} />
        </div>
      )}
    </div>
  );
}
