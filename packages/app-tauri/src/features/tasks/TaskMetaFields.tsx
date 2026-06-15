/**
 * TaskMetaFields — labels, assignees, milestone, and dependency picker block.
 *
 * Extracted sub-component to keep TaskEditModal under 300 lines.
 * Consumed only by TaskEditModal.
 */
import { cn } from '@/lib/utils';
import { LabelAutocomplete } from './LabelAutocomplete';
import { DependencyPicker } from './DependencyPicker';
import type { Todo } from '@/lib/api/todos';

// Physical padding shorthand avoids the Chromium scroll-clip bug on <input>.
const inputCls = cn(
  'bg-background border border-border rounded-md pl-3 pr-3 py-1.5',
  'text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-ring',
  'w-full',
);

interface Props {
  labelList: string[];
  onLabelChange: (v: string[]) => void;
  allLabels: string[];
  assignees: string;
  onAssigneesChange: (v: string) => void;
  milestone: string;
  onMilestoneChange: (v: string) => void;
  dependencies: number[];
  onDepsChange: (v: number[]) => void;
  currentNumber?: number;
  allTodos: Todo[];
}

export function TaskMetaFields({
  labelList,
  onLabelChange,
  allLabels,
  assignees,
  onAssigneesChange,
  milestone,
  onMilestoneChange,
  dependencies,
  onDepsChange,
  currentNumber,
  allTodos,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="text-caption text-muted-foreground">Labels</label>
        <LabelAutocomplete value={labelList} onChange={onLabelChange} allLabels={allLabels} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-caption text-muted-foreground">Assignees (comma-separated)</label>
        <input
          className={inputCls}
          value={assignees}
          onChange={(e) => onAssigneesChange(e.target.value)}
          placeholder="e.g. alice, bob"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-caption text-muted-foreground">Milestone</label>
        <input
          className={inputCls}
          value={milestone}
          onChange={(e) => onMilestoneChange(e.target.value)}
          placeholder="e.g. v1.0, Q1 2026"
        />
      </div>

      <DependencyPicker
        currentNumber={currentNumber}
        allTodos={allTodos}
        value={dependencies}
        onChange={onDepsChange}
      />
    </>
  );
}
