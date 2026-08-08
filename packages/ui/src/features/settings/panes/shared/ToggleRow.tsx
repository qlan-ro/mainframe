import { useId } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}

export function ToggleRow({ label, description, checked, onChange, testId }: ToggleRowProps) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 px-0.5 py-3">
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm text-foreground">
          {label}
        </Label>
        {description !== undefined && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}
