/** What a tool's row opens on, by kind. */
import { useBackgroundStart } from '../../messages/turn/use-background-start';
import { ToolResultImageThumbs, resolveResultText, resultImages } from '../shared';
import { resolveToolDiff } from '../shared/diff-data';
import { argText, createsFile, runsInBackground } from '../../view-model/turn/tool-values';
import { toolKind } from '../../view-model/turn/tool-kind';
import type { ToolPart, ToolStatus } from '../../view-model/turn/types';
import { record } from '../../view-model/turn/values';
import { BackgroundOutput } from './BackgroundOutput';
import { CodeBody } from './CodeBody';
import { DiffBody } from './DiffBody';
import { ResultBlock, ResultText } from './ResultText';
import { BodyNote, KeyValue, Surface } from './Surface';
import { TerminalBody } from './TerminalBody';
import { WebBody } from './WebBody';
import { parseRead, plainLines } from './code-lines';

export interface ToolBodyProps {
  part: ToolPart;
  status: ToolStatus;
}

/** Whether the row has anything to open on. `background`: the daemon holds a task the call started. */
export function hasToolBody(part: ToolPart, status: ToolStatus, background = false): boolean {
  const { text } = resolveResultText(part.result);
  if (text || resultImages(part.result).length) return true;
  switch (toolKind(part.toolName)) {
    case 'edit':
      return true;
    case 'write':
      return Boolean(argText(part, 'content'));
    case 'shell':
      return background || runsInBackground(part) || status === 'success' || status === 'failed';
    case 'mcp':
    case 'unknown':
      return Object.keys(record(part.args) ?? {}).length > 0;
    default:
      return false;
  }
}

/** The change a call made, or tried to make. */
function ChangeBody({ part }: { part: ToolPart }) {
  const kind = toolKind(part.toolName) === 'edit' ? 'Edit' : 'Write';
  const { hunks } = resolveToolDiff(kind, part.args, part.result);
  if (hunks?.length && !(kind === 'Write' && createsFile(part)))
    return <DiffBody id={part.toolCallId} hunks={hunks} testId="chat-edit-diff" />;
  const content = argText(part, 'content');
  if (!content) return null;
  return (
    <CodeBody
      id={part.toolCallId}
      path={argText(part, 'file_path')}
      lines={plainLines(content)}
      testId="chat-write-code"
    />
  );
}

function EditBody({ part, status }: ToolBodyProps) {
  const { text } = resolveResultText(part.result);
  const { hunks } = resolveToolDiff(toolKind(part.toolName) === 'edit' ? 'Edit' : 'Write', part.args, part.result);
  const change = hunks?.length || argText(part, 'content') ? <ChangeBody part={part} /> : null;
  if (status === 'failed' && (change || text))
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {change}
        {text && <ResultBlock part={part} failed testId="chat-tool-error" />}
      </div>
    );
  if (change) return change;
  return text ? (
    <ResultBlock part={part} failed={false} testId="chat-edit-raw" />
  ) : (
    <BodyNote testId="chat-edit-unavailable">Diff unavailable</BodyNote>
  );
}

function ShellBody({ part, status }: ToolBodyProps) {
  const { text, truncated } = resolveResultText(part.result);
  const background = useBackgroundStart(part.toolCallId) !== undefined || runsInBackground(part);
  const command = argText(part, 'command') || argText(part, 'input');
  const description = argText(part, 'description');
  return (
    <>
      {description && <BodyNote testId="chat-bash-description">{description}</BodyNote>}
      {background ? (
        <BackgroundOutput toolCallId={part.toolCallId} command={command} launch={text} />
      ) : truncated ? (
        <Surface className="px-3 py-2">
          <ResultText part={part} />
        </Surface>
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
      {toolKind(part.toolName) === 'mcp' && (
        <KeyValue label="Tool" testId="chat-call-tool">
          {part.toolName}
        </KeyValue>
      )}
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
          <ResultText part={part} />
        </KeyValue>
      )}
    </Surface>
  );
}

/** The file, then what the CLI told the agent about it. */
function ReadBody({ part, text }: { part: ToolPart; text: string }) {
  const { lines, reminders } = parseRead(text);
  return (
    <>
      <CodeBody id={part.toolCallId} path={argText(part, 'file_path')} lines={lines} testId="read-card-code-preview" />
      {reminders.length > 0 && (
        <Surface className="mt-1.5">
          <KeyValue label="Reminder to the agent" testId="chat-read-reminder">
            {reminders.join('\n\n')}
          </KeyValue>
        </Surface>
      )}
    </>
  );
}

function MainBody({ part, status }: ToolBodyProps) {
  const { text, truncated } = resolveResultText(part.result);
  const kind = toolKind(part.toolName);
  if (kind === 'shell') return <ShellBody part={part} status={status} />;
  if (kind === 'mcp' || kind === 'unknown') return <CallBody part={part} status={status} />;
  if (kind === 'edit' || kind === 'write') return <EditBody part={part} status={status} />;
  if (status === 'failed' && text) return <ResultBlock part={part} failed testId="chat-tool-error" />;
  if (kind === 'fetch' || kind === 'web-search')
    return (
      <WebBody url={argText(part, 'url') || undefined} text={truncated ? undefined : text}>
        {truncated && <ResultText part={part} />}
      </WebBody>
    );
  if (!text) return null;
  if (kind === 'read' && !truncated) return <ReadBody part={part} text={text} />;
  return <ResultBlock part={part} failed={false} testId="search-card-plain-body" />;
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
