/**
 * TaskSelectFields — type, priority, status Select trio for the edit modal.
 *
 * Extracted from TaskEditModal to keep that file under 300 lines.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TodoStatus, TodoType, TodoPriority } from '@/lib/api/todos';

const TYPES: TodoType[] = [
  'bug',
  'feature',
  'enhancement',
  'documentation',
  'question',
  'wont_fix',
  'duplicate',
  'invalid',
];
const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: TodoStatus[] = ['open', 'in_progress', 'done'];

interface Props {
  type: TodoType;
  onTypeChange: (v: TodoType) => void;
  priority: TodoPriority;
  onPriorityChange: (v: TodoPriority) => void;
  status: TodoStatus;
  onStatusChange: (v: TodoStatus) => void;
}

export function TaskSelectFields({ type, onTypeChange, priority, onPriorityChange, status, onStatusChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-label text-muted-foreground">Type</label>
        <Select value={type} onValueChange={(v) => onTypeChange(v as TodoType)}>
          <SelectTrigger data-testid="tasks-edit-type" className="text-label h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-label text-muted-foreground">Priority</label>
        <Select value={priority} onValueChange={(v) => onPriorityChange(v as TodoPriority)}>
          <SelectTrigger data-testid="tasks-edit-priority" className="text-label h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-label text-muted-foreground">Status</label>
        <Select value={status} onValueChange={(v) => onStatusChange(v as TodoStatus)}>
          <SelectTrigger data-testid="tasks-edit-status" className="text-label h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
