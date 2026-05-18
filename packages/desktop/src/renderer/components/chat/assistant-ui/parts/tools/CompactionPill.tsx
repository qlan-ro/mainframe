import { Layers } from 'lucide-react';

export function CompactionPill() {
  return (
    <div className="flex justify-center my-2">
      <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-mf-hover/50">
        <Layers size={12} className="text-mf-text-secondary shrink-0" />
        <span className="font-mono text-[11px] text-mf-text-secondary">Context compacted</span>
      </div>
    </div>
  );
}
