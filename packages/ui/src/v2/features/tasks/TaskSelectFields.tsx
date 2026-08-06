/**
 * The type / priority / status trio. Split out so the modal stays readable,
 * not because the three fields differ from one another.
 */
import { Label } from '@v2/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@v2/components/ui/select';
import type { TodoPriority, TodoStatus, TodoType } from '@/lib/api/todos';

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

interface EnumFieldProps<T extends string> {
  label: string;
  testId: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}

function EnumField<T extends string>({ label, testId, options, value, onChange }: EnumFieldProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger data-testid={testId} size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option.replace('_', ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface TaskSelectFieldsProps {
  type: TodoType;
  onTypeChange: (value: TodoType) => void;
  priority: TodoPriority;
  onPriorityChange: (value: TodoPriority) => void;
  status: TodoStatus;
  onStatusChange: (value: TodoStatus) => void;
}

export function TaskSelectFields({
  type,
  onTypeChange,
  priority,
  onPriorityChange,
  status,
  onStatusChange,
}: TaskSelectFieldsProps) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <EnumField label="Type" testId="tasks-edit-type" options={TYPES} value={type} onChange={onTypeChange} />
      <EnumField
        label="Priority"
        testId="tasks-edit-priority"
        options={PRIORITIES}
        value={priority}
        onChange={onPriorityChange}
      />
      <EnumField
        label="Status"
        testId="tasks-edit-status"
        options={STATUSES}
        value={status}
        onChange={onStatusChange}
      />
    </div>
  );
}
