/** One step of a turn (T1a). Agents, delegated tasks, workflows and artifacts have rows of their own. */
import { memo, useMemo } from 'react';
import { FileInput, GitCompare } from 'lucide-react';
import { toFileRef } from '@/lib/files/file-ref';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { ToolBody, hasToolBody } from '../../tools/bodies/ToolBody';
import { useOpenFile } from '../../tools/chat-tool-context';
import { useOpenEdit } from '../../tools/use-open-edit';
import { settledStatus } from '../../view-model/turn/tool-status';
import { argText } from '../../view-model/turn/tool-values';
import { rowName, toolRowFacts, type ToolRowFacts } from '../../view-model/turn/tool-row';
import { toolKind } from '../../view-model/turn/tool-kind';
import type { ToolPart, TurnUnit } from '../../view-model/turn/types';
import { DelegateRow } from '../../orchestration/DelegateRow';
import { WorkflowRow } from '../../workflow/WorkflowRow';
import { AgentRow } from './AgentRow';
import { ArtifactRow } from './ArtifactRow';
import { RowAction, RowDisclosure } from './RowDisclosure';
import { RowGlyph } from './RowGlyph';
import { useStepDuration } from './StepClock';
import { KIND_ICONS, STATUS_WORDS } from './tool-icons';
import { useTranscriptScope } from './transcript-scope';
import { useBackgroundStart } from './use-background-start';
import { useFailedOpen } from './use-failed-open';

export interface ToolRowProps {
  unit: TurnUnit;
  part: ToolPart;
  /** The turn the row belongs to; absent in a sub-agent's own steps. */
  turnKey?: string;
}

export function useToolFacts(part: ToolPart): ToolRowFacts {
  const { pendingToolIds, live } = useTranscriptScope();
  return useMemo(
    () => toolRowFacts(part, settledStatus(part, pendingToolIds, live !== false)),
    [part, pendingToolIds, live],
  );
}

export function receiptText(...parts: (string | undefined)[]): string | undefined {
  return parts.filter(Boolean).join(' · ') || undefined;
}

const FILE_KINDS = new Set(['read', 'edit', 'write']);

/** A path as the project knows it. */
function useRowTarget(part: ToolPart, facts: ToolRowFacts): { target: string; filePath?: string } {
  const bases = useActiveBasesStore((state) => state.bases);
  if (!FILE_KINDS.has(facts.kind) || !facts.target) return { target: facts.target };
  return { target: toFileRef(facts.target, bases).relative, filePath: argText(part, 'file_path') };
}

function FileActions({ part, kind, target }: { part: ToolPart; kind: string; target: string }) {
  const { openFile } = useOpenFile();
  const openEdit = useOpenEdit(part);
  const path = argText(part, 'file_path');
  if (!path) return null;
  return (
    <>
      <RowAction
        hoverOnly
        label={`Open ${target} in the editor`}
        testId={`chat-row-open-file-${part.toolCallId}`}
        onClick={() => openFile(path)}
      >
        <FileInput />
      </RowAction>
      {kind === 'edit' && (
        <RowAction
          label={`Open ${target} in the diff editor`}
          testId={`chat-row-open-diff-${part.toolCallId}`}
          onClick={openEdit}
        >
          <GitCompare />
        </RowAction>
      )}
    </>
  );
}

function Receipt({ facts, duration }: { facts: ToolRowFacts; duration?: string }) {
  if (facts.diff)
    return (
      <>
        <span className="text-mf-tr-ok">+{facts.diff.added}</span>{' '}
        <span className="text-mf-tr-del">−{facts.diff.removed}</span>
      </>
    );
  // Reads, searches and edits are near-instant; their size is the receipt.
  const timed = facts.status !== 'success' || !['read', 'write', 'grep', 'glob', 'list'].includes(facts.kind);
  return <>{receiptText(facts.receipt, timed ? duration : undefined)}</>;
}

function StandardRow({ unit, part, turnKey }: ToolRowProps) {
  const call = useToolFacts(part);
  const startedAt = useBackgroundStart(part.toolCallId);
  const facts: ToolRowFacts =
    startedAt === undefined ? call : { ...call, status: 'running', verb: 'Running', timing: { startedAt } };
  const { status, kind } = facts;
  const duration = useStepDuration({ ...facts, running: status === 'running' });
  const failedOpen = useFailedOpen(turnKey, part.toolCallId);
  const { target, filePath } = useRowTarget(part, facts);
  const hasReceipt = Boolean(facts.diff || facts.receipt || duration);
  return (
    <RowDisclosure
      rowKey={unit.key}
      testId={`chat-row-${part.toolCallId}`}
      name={rowName({ ...facts, target })}
      statusWord={STATUS_WORDS[status]}
      icon={<RowGlyph icon={KIND_ICONS[kind]} status={status} />}
      verb={facts.verb}
      target={target}
      mono={facts.mono}
      where={facts.where}
      receipt={hasReceipt && <Receipt facts={facts} duration={duration} />}
      tone={status === 'failed' ? 'fail' : status === 'awaiting-approval' ? 'warn' : undefined}
      actions={FILE_KINDS.has(kind) ? <FileActions part={part} kind={kind} target={target} /> : undefined}
      defaultOpen={failedOpen}
      filePath={filePath}
      tool={part.toolName}
      anchor={{ 'data-activity-id': part.toolCallId }}
    >
      {hasToolBody(part, status, startedAt !== undefined) ? <ToolBody part={part} status={status} /> : undefined}
    </RowDisclosure>
  );
}

export const ToolRow = memo(function ToolRow(props: ToolRowProps) {
  switch (toolKind(props.part.toolName)) {
    case 'subagent':
      return <AgentRow {...props} />;
    case 'delegate':
      return <DelegateRow {...props} />;
    case 'workflow':
      return <WorkflowRow {...props} />;
    case 'artifact':
      return <ArtifactRow {...props} />;
    default:
      return <StandardRow {...props} />;
  }
});
