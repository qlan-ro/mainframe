/**
 * SettingsSidebar — the sidebar's Settings view (the nav rail's Settings
 * button, D1/D2). Category rows restyled from the old two-pane dialog's own
 * 184px nav column to the sidebar's row convention — same header pattern as
 * the other views (`SidebarHeader` + `text-base font-semibold` title), rows
 * like `TaskSidebarRow`/`AutomationSidebarRow`, the selected row
 * `bg-sidebar-selection`. "Providers" expands into one sub-row per adapter.
 * Settings has no project scope, so there is no `SidebarScopeStrip` here.
 */
import { cn } from '@/lib/utils';
import { useAdapters } from '@/store/adapters';
import { SidebarHeader } from '@/components/ui/sidebar';
import { SidebarScrollRegion } from '@/features/shared/SidebarScrollRegion';
import { useSettingsStore, type SettingsTab } from '../../store/settings';
import { providerDotColor } from '../shared/provider-avatar';
import { SETTINGS_TABS } from './settings-tabs';

/** The provider's brand hue (the same source as `ProviderDot`), or the muted ink for providers without one. */
function providerHue(id: string): string {
  return providerDotColor(id) ?? 'var(--muted-foreground)';
}

interface NavItemProps {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  testId: string;
}

function SettingsNavItem({ label, icon: Icon, active, onClick, testId }: NavItemProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors',
        active
          ? 'bg-sidebar-selection font-semibold text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
      )}
    >
      <Icon size={14} className={cn('flex-shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function ProviderSubItems({ activeProvider }: { activeProvider: string | null }) {
  const adapters = useAdapters();
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);

  return (
    <div className="flex flex-col gap-px py-px pl-5">
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
              'flex h-6.5 items-center gap-2 border-l-2 pl-2 pr-2 text-left text-xs transition-colors',
              active
                ? 'bg-sidebar-selection font-semibold text-foreground'
                : 'border-l-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
            )}
          >
            <span
              style={{ backgroundColor: providerHue(adapter.id) }}
              className="inline-flex size-[14px] shrink-0 items-center justify-center rounded-xs text-[10px] font-bold text-white ring-1 ring-inset ring-black/10"
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
    <>
      <SidebarHeader className="gap-3">
        <div className="flex h-9 items-center pl-1">
          <span className="text-base font-semibold">Settings</span>
        </div>
      </SidebarHeader>
      <SidebarScrollRegion>
        <div className="flex flex-col gap-0.5 px-2">
          {SETTINGS_TABS.map((tab) => (
            <div key={tab.id}>
              <SettingsNavItem
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
        </div>
      </SidebarScrollRegion>
    </>
  );
}
