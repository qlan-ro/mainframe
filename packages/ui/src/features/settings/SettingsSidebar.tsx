import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getAdapters } from '@/lib/api/adapters';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../../store/settings';
import { providerDot } from '../chat/composer/config-toolbar/ProviderModelSelect';
import { SETTINGS_TABS } from './settings-tabs';

/** The provider's brand colour as a left-border utility (mirrors the composer's provider dot). */
function providerBorder(id: string): string {
  return providerDot(id).replace('bg-', 'border-l-');
}

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
        'flex w-full items-center gap-2.5 rounded-md px-[9px] py-[7px] text-left text-label transition-colors',
        active
          ? 'bg-mf-selection font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon size={14} className={cn('flex-shrink-0', active ? 'text-primary' : 'text-mf-text-3')} />
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
    <div className="flex flex-col gap-px py-px">
      {adapters.map((adapter) => {
        const active = activeProvider === adapter.id;
        const name = adapter.name ?? adapter.id;
        return (
          <button
            key={adapter.id}
            type="button"
            data-testid={`settings-nav-provider-${adapter.id}`}
            onClick={() => setSelectedProvider(adapter.id)}
            className={cn(
              'flex items-center gap-2 border-l-2 py-[5px] pl-[26px] pr-[9px] text-left text-label transition-colors',
              active
                ? cn('bg-mf-selection font-semibold text-foreground', providerBorder(adapter.id))
                : 'border-l-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'inline-flex size-[15px] shrink-0 items-center justify-center rounded-xs text-micro font-bold text-white ring-1 ring-inset ring-black/10',
                providerDot(adapter.id),
              )}
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsSidebar({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);

  return (
    <nav className="flex w-[184px] flex-shrink-0 flex-col gap-px overflow-y-auto border-r border-border bg-mf-content2 p-4">
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
