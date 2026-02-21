import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { getProviderSettings, getGeneralSettings } from '../lib/api';
import { getAdapterOptions } from '../lib/adapters';
import { useAdaptersStore } from '../store/adapters';
import { SidebarTab } from './settings/SidebarTab';
import { ProviderSection } from './settings/ProviderSection';
import { GeneralSection } from './settings/GeneralSection';
import { SIDEBAR_TABS, PROVIDER_COLORS, PROVIDER_BORDER_COLORS } from './settings/constants';
import { AboutSection } from './settings/AboutSection';

function ProvidersContent() {
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const adapters = useAdaptersStore((s) => s.adapters);
  const adapterOptions = getAdapterOptions(adapters);

  if (!selectedProvider) return null;

  const adapter = adapterOptions.find((a) => a.id === selectedProvider);
  const label = adapter?.label ?? selectedProvider;

  return <ProviderSection adapterId={selectedProvider} label={label} />;
}

function PlaceholderContent({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <p className="text-mf-body text-mf-text-secondary">{label} — coming soon</p>
    </div>
  );
}

function TabContent() {
  const activeTab = useSettingsStore((s) => s.activeTab);

  switch (activeTab) {
    case 'providers':
      return <ProvidersContent />;
    case 'general':
      return <GeneralSection />;
    case 'keybindings':
      return <PlaceholderContent label="Keybindings" />;
    case 'about':
      return <AboutSection />;
  }
}

export function SettingsModal(): React.ReactElement | null {
  const { isOpen, close, activeTab, setActiveTab, loadProviders, loadGeneral, setLoading } = useSettingsStore();
  const adapters = useAdaptersStore((s) => s.adapters);
  const adapterOptions = getAdapterOptions(adapters);

  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);

  // Load settings on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([getProviderSettings().then(loadProviders), getGeneralSettings().then(loadGeneral)])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [isOpen, loadProviders, loadGeneral, setLoading, selectedProvider, setSelectedProvider]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-mf-overlay/50" onClick={close} />

      {/* Panel */}
      <div className="relative w-[720px] h-[600px] bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-mf-divider">
          <h2 className="text-mf-title font-semibold text-mf-text-primary">Settings</h2>
          <button
            onClick={close}
            className="p-1 rounded-mf-input text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-[160px] border-r border-mf-divider bg-mf-app-bg py-2 flex flex-col">
            <div className="flex-1 space-y-0.5">
              {SIDEBAR_TABS.map((tab) => (
                <React.Fragment key={tab.id}>
                  <SidebarTab
                    tab={tab}
                    active={
                      tab.id === 'providers' ? activeTab === 'providers' && !selectedProvider : activeTab === tab.id
                    }
                    onClick={() => {
                      setActiveTab(tab.id);
                      setSelectedProvider(
                        tab.id === 'providers' ? (selectedProvider ?? adapterOptions[0]?.id ?? null) : null,
                      );
                    }}
                  />
                  {/* Provider sub-items */}
                  {tab.id === 'providers' &&
                    activeTab === 'providers' &&
                    adapterOptions.map((adapter) => {
                      const isActive = selectedProvider === adapter.id;
                      return (
                        <button
                          key={adapter.id}
                          onClick={() => {
                            setActiveTab('providers');
                            setSelectedProvider(adapter.id);
                          }}
                          className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-mf-small transition-colors ${
                            isActive
                              ? `bg-mf-hover text-mf-text-primary border-l-2 ${PROVIDER_BORDER_COLORS[adapter.id] ?? 'border-mf-accent-claude'}`
                              : 'text-mf-text-secondary hover:bg-mf-hover/50 border-l-2 border-transparent'
                          }`}
                        >
                          <div
                            className={`w-[14px] h-[14px] rounded-sm ${PROVIDER_COLORS[adapter.id] ?? 'bg-mf-hover'} flex items-center justify-center`}
                          >
                            <span className="text-mf-micro font-semibold text-white leading-none">
                              {adapter.label.charAt(0)}
                            </span>
                          </div>
                          <span>{adapter.label}</span>
                        </button>
                      );
                    })}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <TabContent />
          </div>
        </div>
      </div>
    </div>
  );
}
