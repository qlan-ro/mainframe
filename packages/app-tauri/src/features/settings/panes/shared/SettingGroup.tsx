import type { ReactNode } from 'react';

interface SettingGroupProps {
  title: string;
  children: ReactNode;
}

export function SettingGroup({ title, children }: SettingGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-medium text-mf-text-secondary uppercase tracking-wide mb-1">{title}</h4>
      <div className="divide-y divide-mf-border">{children}</div>
    </div>
  );
}
