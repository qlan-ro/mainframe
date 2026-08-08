import { Frame, Smartphone } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface PreviewDeviceToggleProps {
  device: 'desktop' | 'mobile';
  onChange: (d: 'desktop' | 'mobile') => void;
}

/**
 * Desktop ⇄ mobile viewport switch. One-of-N exclusive, so it is the v2 Tabs
 * List+Trigger recipe (no TabsContent — the panel it switches is the webview,
 * which the surface owns). `activationMode="manual"`: `onChange` writes, and
 * automatic activation would fire again on focus.
 */
export function PreviewDeviceToggle({ device, onChange }: PreviewDeviceToggleProps) {
  return (
    <Tabs
      data-testid="preview-device-toggle"
      value={device}
      onValueChange={(v) => onChange(v as 'desktop' | 'mobile')}
      activationMode="manual"
      className="shrink-0"
    >
      <TabsList className="gap-px rounded-md p-0.5 group-data-horizontal/tabs:h-6">
        <TabsTrigger
          data-testid="preview-device-desktop"
          value="desktop"
          aria-label="Desktop view"
          className="px-2 [&_svg:not([class*='size-'])]:size-3"
        >
          <Frame />
        </TabsTrigger>
        <TabsTrigger
          data-testid="preview-device-mobile"
          value="mobile"
          aria-label="Mobile view"
          className="px-2 [&_svg:not([class*='size-'])]:size-3"
        >
          <Smartphone />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
