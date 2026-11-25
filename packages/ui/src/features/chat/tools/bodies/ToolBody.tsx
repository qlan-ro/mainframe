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

/** Whether there is content for the tool-specific renderer. */
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
    return <DiffBody id={part.toolCallId} hunks={hunks} path={argText(part, 'file_path')} testId="chat-edit-diff" />;
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
      {description && (
        <p data-testid="chat-bash-description" className="mb-1.5 text-meta/5.5 text-muted-foreground">
          {description}
        </p>
      )}
      {background ? (
        <BackgroundOutput toolCallId={part.toolCallId} command={command} launch={text} />
      ) : truncated ? (
        <ResultText part={part} renderPreview={(output) => <TerminalBody output={output} />} />
      ) : (
        <TerminalBody command={command} output={text || (status === 'running' ? '' : '(no output)')} />
      )}
    </>
  );
}

function compactArguments(args: Record<string, unknown>) {
  const compact = JSON.stringify(args);
  if (compact.length > 120) return JSON.stringify(args, null, 2);
  const fields = Object.entries(JSON.parse(compact) as Record<string, unknown>);
  if (fields.length === 0) return '{}';
  return `{ ${fields.map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`).join(', ')} }`;
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
      <KeyValue label="Arguments" testId="chat-call-args">
        {compactArguments(args)}
      </KeyValue>
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

function highlightedSearchText(text: string, query: string) {
  if (!query || !text.includes(query)) return text;
  let offset = 0;
  return text.split(query).map((part, index) => {
    const key = offset;
    offset += part.length + query.length;
    return (
      <span key={key}>
        {index > 0 && (
          <mark className="rounded-[2px] bg-[color-mix(in_srgb,var(--warning-dot)_26%,transparent)] text-inherit">
            {query}
          </mark>
        )}
        {part}
      </span>
    );
  });
}

function grepExcerpt(text: string, query: string) {
  let offset = 0;
  const lines = text.split(/(?<=\n)/).map((line) => {
    const location = /^[^:\r\n]+:\d+:/.exec(line)?.[0];
    return { line, location };
  });
  const column = lines.reduce((max, { location }) => Math.max(max, (location?.length ?? 0) - 1), 0);
  return (
    <pre className="whitespace-pre">
      {lines.map(({ line, location }) => {
        const key = offset;
        offset += line.length;
        return location ? (
          <span key={key}>
            <span className="mr-4 inline-block text-muted-foreground" style={{ width: `${column}ch` }}>
              {location}
            </span>
            {highlightedSearchText(line.slice(location.length), query)}
          </span>
        ) : (
          <span key={key}>{highlightedSearchText(line, query)}</span>
        );
      })}
    </pre>
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
  return (
    <ResultBlock
      part={part}
      failed={false}
      testId="search-card-plain-body"
      renderPreview={kind === 'grep' ? (result) => grepExcerpt(result, argText(part, 'pattern')) : undefined}
    />
  );
}

function imagePreview(part: ToolPart): 'file' | 'browser' | undefined {
  if (toolKind(part.toolName) === 'read') return 'file';
  return /(?:^|__)browser_take_screenshot$/.test(part.toolName) ? 'browser' : undefined;
}

export function ToolBody({ part, status }: ToolBodyProps) {
  const background = useBackgroundStart(part.toolCallId) !== undefined;
  const images = resultImages(part.result);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="min-w-0 empty:hidden">
        {hasToolBody(part, status, background) ? (
          <MainBody part={part} status={status} />
        ) : (
          <CallBody part={part} status={status} />
        )}
      </div>
      {images.length > 0 && (
        <div data-testid="chat-tool-images">
          <ToolResultImageThumbs toolCallId={part.toolCallId} images={images} preview={imagePreview(part)} />
        </div>
      )}
    </div>
  );
}
