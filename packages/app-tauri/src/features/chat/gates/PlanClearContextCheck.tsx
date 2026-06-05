import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export interface PlanClearContextCheckProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

export function PlanClearContextCheck({ checked, onChange }: PlanClearContextCheckProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="plan-clear-context"
        data-testid="chat-plan-clear-context"
        checked={checked}
        onCheckedChange={(val) => onChange(val === true)}
      />
      <Label htmlFor="plan-clear-context" className="cursor-pointer text-label text-muted-foreground">
        Clear context
      </Label>
    </div>
  );
}
