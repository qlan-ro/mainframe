/** An artifact the agent published or read, with the ways to open it. */
import { AppWindow, ExternalLink } from 'lucide-react';
import { useOpenArtifact } from '@/features/artifacts/use-open-artifact';
import { useOpenExternal } from '../../links/use-open-link';
import { describeArtifactCall } from '../../tools/cards/artifact-call';
import { ResultBlock } from '../../tools/bodies/ResultText';
import { BodyNote } from '../../tools/bodies/Surface';
import { resolveResultText } from '../../tools/shared';
import { record } from '../../view-model/turn/values';
import { RowAction, RowDisclosure } from './RowDisclosure';
import { RowGlyph, Spinner } from './RowGlyph';
import { receiptText, useToolFacts, type ToolRowProps } from './ToolRow';
import { useStepDuration } from './StepClock';
import { KIND_ICONS, STATUS_WORDS } from './tool-icons';
import { useFailedOpen } from './use-failed-open';

function OpenActions({ url }: { url: string }) {
  const { open, opening } = useOpenArtifact();
  const openExternal = useOpenExternal();
  return (
    <>
      <RowAction
        label={opening ? 'Opening the artifact…' : 'Open the artifact'}
        testId="artifact-card-open"
        busy={opening}
        onClick={() => void open(url)}
      >
        {opening ? <Spinner /> : <AppWindow />}
      </RowAction>
      <RowAction label="Open on claude.ai" testId="artifact-card-open-browser" onClick={() => openExternal(url)}>
        <ExternalLink />
      </RowAction>
    </>
  );
}

export function ArtifactRow({ unit, part, turnKey }: ToolRowProps) {
  const facts = useToolFacts({ unit, part });
  const { status } = facts;
  const { text } = resolveResultText(part.result);
  const call = describeArtifactCall(record(part.args) ?? {}, text);
  const failed = status === 'failed';
  const failedOpen = useFailedOpen(turnKey, part.toolCallId, unit.key, unit.messageId);
  const duration = useStepDuration({ ...facts, running: status === 'running' });
  const showText = text && (failed || call.showResult);
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-row-${part.toolCallId}`}
      name={[call.verb, call.label].filter(Boolean).join(' ')}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS.artifact} status={status} />}
      verb={status === 'success' ? call.verb.replace(/^Publish/, 'Published').replace(/^Create/, 'Created') : call.verb}
      target={call.label}
      receipt={receiptText(facts.receipt, duration)}
      tone={failed ? 'fail' : undefined}
      actions={status === 'success' && call.url ? <OpenActions url={call.url} /> : undefined}
      defaultOpen={failedOpen}
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      {showText ? (
        <ResultBlock part={part} failed={failed} testId="artifact-card-result" />
      ) : status === 'success' && !call.url ? (
        <BodyNote>The CLI reported no address for it.</BodyNote>
      ) : undefined}
    </RowDisclosure>
  );
}
