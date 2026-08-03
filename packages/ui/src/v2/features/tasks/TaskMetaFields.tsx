/**
 * Labels, assignees, milestone and dependencies — the block below the fold of
 * the edit modal. Split out to keep that file inside the size limit.
 */
import { Input } from '@v2/components/ui/input';
import { Label } from '@v2/components/ui/label';
import type { Todo } from '@/lib/api/todos';
import { DependencyPicker } from './DependencyPicker';
import { LabelAutocomplete } from './LabelAutocomplete';

interface TaskMetaFieldsProps {
  labelList: string[];
  onLabelChange: (value: string[]) => void;
  allLabels: string[];
  assignees: string;
  onAssigneesChange: (value: string) => void;
  milestone: string;
  onMilestoneChange: (value: string) => void;
  dependencies: number[];
  onDepsChange: (value: number[]) => void;
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
}: TaskMetaFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tasks-edit-labels">Labels</Label>
        <LabelAutocomplete value={labelList} onChange={onLabelChange} allLabels={allLabels} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tasks-edit-assignees">Assignees</Label>
        <Input
          id="tasks-edit-assignees"
          data-testid="tasks-edit-assignees"
          value={assignees}
          onChange={(e) => onAssigneesChange(e.target.value)}
          placeholder="Comma-separated — e.g. alice, bob"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tasks-edit-milestone">Milestone</Label>
        <Input
          id="tasks-edit-milestone"
          data-testid="tasks-edit-milestone"
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
