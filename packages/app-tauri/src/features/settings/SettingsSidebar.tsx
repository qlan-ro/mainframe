import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getAdapters } from '@/lib/api/adapters';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../store/settings';
import { SETTINGS_TABS } from './settings-tabs';

interface NavItemProps {
  id: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  testId: string;
}

function SettingsNavItem({ id: _id, label, icon: Icon, active, onClick, testId }: NavItemProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-body transition-colors',
        active
          ? 'bg-mf-selection text-foreground font-medium'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon size={15} className="flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function ProviderSubItems({ port, activeProvider }: { port: number; activeProvider: string | null }) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);

  useEffect(() => {
    getAdapters(port)
      .then(setAdapters)
      .catch((err: unknown) => console.warn('[settings/SettingsSidebar]', err));
  }, [port]);

  return (
    <div className="ml-5 flex flex-col gap-0.5 border-l border-border pl-3">
      {adapters.map((adapter) => (
        <button
          key={adapter.id}
          type="button"
          data-testid={`settings-nav-provider-${adapter.id}`}
          onClick={() => setSelectedProvider(adapter.id)}
          className={cn(
            'rounded-md px-2 py-1.5 text-left text-body transition-colors',
            activeProvider === adapter.id
              ? 'bg-mf-selection text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          {adapter.name ?? adapter.id}
        </button>
      ))}
    </div>
  );
}

export function SettingsSidebar({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);

  return (
    <nav className="flex w-48 flex-shrink-0 flex-col gap-0.5 border-r border-border p-3">
      {SETTINGS_TABS.map((tab) => (
        <div key={tab.id}>
          <SettingsNavItem
            id={tab.id}
            label={tab.label}
            icon={tab.icon}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            testId={`settings-nav-${tab.id}`}
          />
          {tab.id === 'providers' && activeTab === 'providers' && (
            <ProviderSubItems port={port} activeProvider={selectedProvider} />
          )}
        </div>
      ))}
    </nav>
  );
}
