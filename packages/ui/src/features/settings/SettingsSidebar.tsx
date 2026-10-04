import { cn } from '@/lib/utils';
import { useAdapters } from '@/store/adapters';
import { useSettingsStore, type SettingsTab } from '../../store/settings';
import { providerDotColor } from '../shared/provider-avatar';
import { SETTINGS_TABS } from './settings-tabs';

/** The provider's brand hue (the same source as `ProviderDot`), or the muted ink for providers without one. */
function providerHue(id: string): string {
  return providerDotColor(id) ?? 'var(--muted-foreground)';
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
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        active
          ? 'bg-sidebar-selection font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Icon size={14} className={cn('flex-shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
      <span>{label}</span>
    </button>
  );
}

function ProviderSubItems({ activeProvider }: { activeProvider: string | null }) {
  const adapters = useAdapters();
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);

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
            // Brand hue inline: it is a literal in provider-avatar.ts, not a token.
            style={active ? { borderLeftColor: providerHue(adapter.id) } : undefined}
            className={cn(
              'flex items-center gap-2 border-l-2 py-1 pl-6 pr-2 text-left text-sm transition-colors',
              active
                ? 'bg-sidebar-selection font-semibold text-foreground'
                : 'border-l-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span
              style={{ backgroundColor: providerHue(adapter.id) }}
              className="inline-flex size-[15px] shrink-0 items-center justify-center rounded-xs text-[10px] font-bold text-white ring-1 ring-inset ring-black/10"
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

export function SettingsSidebar() {
  const activeTab = useSettingsStore((s) => s.activeTab);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);
  const adapters = useAdapters();

  function handleTabClick(tabId: SettingsTab) {
    setActiveTab(tabId);
    // Opening "Providers" with nothing selected used to leave ProvidersPane on
    // its blank state until the user picked a provider from the sub-nav below.
    if (tabId === 'providers' && selectedProvider == null) {
      const first = adapters.find((a) => a.installed) ?? adapters[0];
      if (first) setSelectedProvider(first.id);
    }
  }

  return (
    <nav className="flex w-[184px] flex-shrink-0 flex-col gap-px overflow-y-auto border-r bg-sidebar p-4">
      {SETTINGS_TABS.map((tab) => (
        <div key={tab.id}>
          <SettingsNavItem
            id={tab.id}
            label={tab.label}
            icon={tab.icon}
            active={activeTab === tab.id}
            onClick={() => handleTabClick(tab.id)}
            testId={`settings-nav-${tab.id}`}
          />
          {tab.id === 'providers' && activeTab === 'providers' && (
            <ProviderSubItems activeProvider={selectedProvider} />
          )}
        </div>
      ))}
    </nav>
  );
}
