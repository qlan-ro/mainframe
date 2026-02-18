import React from 'react';
import type { SIDEBAR_TABS } from './constants';

export function SidebarTab({
  tab,
  active,
  onClick,
}: {
  tab: (typeof SIDEBAR_TABS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-mf-small transition-colors ${
        active
          ? 'bg-mf-hover text-mf-text-primary border-l-2 border-mf-accent'
          : 'text-mf-text-secondary hover:bg-mf-hover/50 border-l-2 border-transparent'
      }`}
    >
      <Icon size={15} />
      <span>{tab.label}</span>
    </button>
  );
}
