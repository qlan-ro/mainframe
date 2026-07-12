import type { ReactNode } from 'react';

interface SettingGroupProps {
  title: string;
  children: ReactNode;
}

export function SettingGroup({ title, children }: SettingGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="mb-1 text-caption font-medium text-muted-foreground">{title}</h4>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}
