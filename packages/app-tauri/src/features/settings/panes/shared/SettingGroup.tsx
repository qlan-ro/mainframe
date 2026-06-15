import type { ReactNode } from 'react';

interface SettingGroupProps {
  title: string;
  children: ReactNode;
}

export function SettingGroup({ title, children }: SettingGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-label font-medium text-mf-text-secondary uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
        {title}
      </h4>
      <div className="divide-y divide-mf-border">{children}</div>
    </div>
  );
}
