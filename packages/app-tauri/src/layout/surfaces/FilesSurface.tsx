import { FileText } from 'lucide-react';

export function FilesSurface() {
  return (
    <div data-testid="files-surface" className="flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden">
      <FileText size={32} className="text-muted-foreground opacity-30" />
      <span className="text-sm text-muted-foreground">Editor — coming soon</span>
    </div>
  );
}
