import { Switch } from '../../../../components/ui/switch';
import { Label } from '../../../../components/ui/label';

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}

export function ToggleRow({ label, description, checked, onChange, testId }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <Label className="text-sm text-mf-text-primary cursor-pointer">{label}</Label>
        {description !== undefined && <p className="text-xs text-mf-text-secondary mt-0.5">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}
