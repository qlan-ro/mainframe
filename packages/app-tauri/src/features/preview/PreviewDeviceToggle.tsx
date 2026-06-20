import { Frame, Smartphone } from 'lucide-react';

interface PreviewDeviceToggleProps {
  device: 'desktop' | 'mobile';
  onChange: (d: 'desktop' | 'mobile') => void;
}

export function PreviewDeviceToggle({ device, onChange }: PreviewDeviceToggleProps) {
  return (
    <div
      data-testid="preview-device-toggle"
      className="flex gap-px p-0.5 rounded-sm bg-mf-chip"
    >
      <button
        data-testid="preview-device-desktop"
        className={`w-[24px] h-[20px] rounded-xs flex items-center justify-center ${
          device === 'desktop' ? 'bg-background shadow-[var(--mf-shadow-rail-active)]' : 'bg-transparent'
        }`}
        onClick={() => onChange('desktop')}
        aria-label="Desktop view"
      >
        <Frame
          size={12}
          className={device === 'desktop' ? 'text-foreground' : 'text-muted-foreground'}
        />
      </button>
      <button
        data-testid="preview-device-mobile"
        className={`w-[24px] h-[20px] rounded-xs flex items-center justify-center ${
          device === 'mobile' ? 'bg-background shadow-[var(--mf-shadow-rail-active)]' : 'bg-transparent'
        }`}
        onClick={() => onChange('mobile')}
        aria-label="Mobile view"
      >
        <Smartphone
          size={12}
          className={device === 'mobile' ? 'text-foreground' : 'text-muted-foreground'}
        />
      </button>
    </div>
  );
}
