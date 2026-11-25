/** A run of steps as rows, text between them as plain lines, long explorations folded. */
import { memo, useMemo } from 'react';
import { FolderSearch } from 'lucide-react';
import { exploreSummary } from '../../view-model/turn/turn-summary';
import { isMarkerTool } from '../../view-model/turn/tool-kind';
import { groupSteps, type ExploreStep, type Step } from '../../view-model/turn/group-steps';
import type { ToolPart, TurnUnit } from '../../view-model/turn/types';
import { EventMarker } from '../../tools/markers/EventMarker';
import { RowDisclosure } from './RowDisclosure';
import { ImageRow, TextUnit, ThoughtRow } from './TextUnit';
import { ToolRow } from './ToolRow';
import { useTranscriptScope } from './transcript-scope';

function ExploreRow({ step, turnKey }: { step: ExploreStep; turnKey?: string }) {
  const parts = step.units.map((unit) => unit.part as ToolPart);
  const summary = exploreSummary(parts);
  return (
    <RowDisclosure
      rowKey={`explore:${step.key}`}
      testId={`chat-explore-${parts[0]!.toolCallId}`}
      name={`Explored ${summary}`}
      statusWord="Done"
      icon={<FolderSearch aria-hidden />}
      verb="Explored"
      target={summary}
      receipt={`${parts.length} steps`}
      steps
      anchor={{ 'data-activity-group': parts.map((part) => part.toolCallId).join(' ') }}
    >
      {step.units.map((unit) => (
        <ToolRow key={unit.key} unit={unit} part={unit.part as ToolPart} turnKey={turnKey} />
      ))}
    </RowDisclosure>
  );
}

export const StepUnit = memo(function StepUnit({ unit, turnKey }: { unit: TurnUnit; turnKey?: string }) {
  const { part } = unit;
  if (part.type === 'reasoning') return <ThoughtRow unit={unit} />;
  if (part.type === 'image') return <ImageRow unit={unit} />;
  if (part.type !== 'tool-call') return <TextUnit unit={unit} step />;
  if (isMarkerTool(part.toolName)) return <EventMarker unit={unit} part={part} />;
  return <ToolRow unit={unit} part={part} turnKey={turnKey} />;
});

/** The entries a list of steps draws, each keyed by its first unit so a row keeps its place as others join. */
export function useSteps(units: readonly TurnUnit[], open = false) {
  const { pendingToolIds } = useTranscriptScope();
  return useMemo(() => groupSteps(units, pendingToolIds, open), [units, pendingToolIds, open]);
}

export function StepEntry({ step, turnKey }: { step: Step; turnKey?: string }) {
  return step.type === 'explore' ? (
    <ExploreRow step={step} turnKey={turnKey} />
  ) : (
    <StepUnit unit={step.unit} turnKey={turnKey} />
  );
}

export function StepList({ units }: { units: readonly TurnUnit[] }) {
  const steps = useSteps(units);
  return (
    <>
      {steps.map((step) => (
        <StepEntry key={step.key} step={step} />
      ))}
    </>
  );
}
