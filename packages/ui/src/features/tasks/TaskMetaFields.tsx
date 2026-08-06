/**
 * TaskMetaFields — labels, assignees, milestone, and dependency picker block.
 *
 * Extracted sub-component to keep TaskEditModal under 300 lines.
 * Consumed only by TaskEditModal.
 */
import { Input } from '@v2/components/ui/input';
import { Label } from '@v2/components/ui/label';
import { LabelAutocomplete } from './LabelAutocomplete';
import { DependencyPicker } from './DependencyPicker';
import type { Todo } from '@/lib/api/todos';

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
      <div className="flex flex-col gap-1.5">
        <Label className="text-muted-foreground">Labels</Label>
        <LabelAutocomplete value={labelList} onChange={onLabelChange} allLabels={allLabels} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tasks-edit-assignees" className="text-muted-foreground">
          Assignees (comma-separated)
        </Label>
        <Input
          id="tasks-edit-assignees"
          data-testid="tasks-edit-assignees"
          value={assignees}
          onChange={(e) => onAssigneesChange(e.target.value)}
          placeholder="e.g. alice, bob"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tasks-edit-milestone" className="text-muted-foreground">
          Milestone
        </Label>
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
