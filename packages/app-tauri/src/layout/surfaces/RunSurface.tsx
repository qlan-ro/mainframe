import { Play } from 'lucide-react';

export function RunSurface() {
  return (
    <div data-testid="run-surface" className="flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden">
      <Play size={32} className="text-muted-foreground opacity-30" />
      <span className="text-sm text-muted-foreground">Preview — coming soon</span>
    </div>
  );
}
