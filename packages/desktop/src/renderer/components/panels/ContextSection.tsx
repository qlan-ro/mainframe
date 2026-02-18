import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface ContextSectionProps {
  icon: LucideIcon;
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function ContextSection({ icon: Icon, title, count, defaultOpen, children }: ContextSectionProps) {
  if (count === 0) return null;

  return (
    <details open={defaultOpen} className="group">
      <summary className="flex items-center gap-2 px-2 py-1.5 rounded-mf-input hover:bg-mf-hover cursor-pointer text-mf-body text-mf-text-primary select-none">
        <Icon size={14} className="text-mf-text-secondary shrink-0" />
        <span className="flex-1">{title}</span>
        <span className="text-mf-status text-mf-text-secondary bg-mf-hover rounded-full px-1.5 min-w-[20px] text-center">
          {count}
        </span>
      </summary>
      <div className="pl-2 mt-1 space-y-1">{children}</div>
    </details>
  );
}
