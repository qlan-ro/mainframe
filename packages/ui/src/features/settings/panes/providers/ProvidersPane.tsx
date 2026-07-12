import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { cn } from '../../../../lib/utils';
import { useSettingsStore } from '../../../../store/settings';
import { useAdapters } from '../../../../store/adapters';
import { providerDot } from '../../../chat/composer/config-toolbar/ProviderModelSelect';
import { ProviderConfigForm } from './ProviderConfigForm';

interface ProvidersPaneProps {
  port: number;
}

/** Avatar tile + name + installed/not-installed status row that anchors each provider pane. */
function ProviderHeader({ adapter }: { adapter: AdapterInfo }) {
  return (
    <div data-testid={`settings-provider-header-${adapter.id}`} className="flex items-center gap-3">
      <span
        className={cn(
          'inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-heading font-bold text-white',
          providerDot(adapter.id),
        )}
      >
        {adapter.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0">
        <h3 className="text-title font-bold text-foreground">{adapter.name}</h3>
        <div className="flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', adapter.installed ? 'bg-mf-success' : 'bg-mf-text-3')} />
          <span className="text-label text-muted-foreground">
            {adapter.installed ? 'Detected on PATH' : 'Not installed'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Reads `selectedProvider` from the store, fetches the adapter list from the daemon,
 *  finds the matching AdapterInfo, and renders the form. */
export function ProvidersPane({ port }: ProvidersPaneProps) {
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const adapters = useAdapters();

  const adapter = adapters.find((a) => a.id === selectedProvider);

  return (
    <div data-testid="settings-pane-providers" className="flex flex-col gap-4 p-4">
      {!selectedProvider && (
        <p className="text-body text-muted-foreground">Select a provider from the sidebar to configure it.</p>
      )}
      {selectedProvider && !adapter && adapters.length > 0 && (
        <p className="text-body text-muted-foreground">Provider &ldquo;{selectedProvider}&rdquo; not found.</p>
      )}
      {selectedProvider && adapter && (
        <>
          <ProviderHeader adapter={adapter} />
          <ProviderConfigForm port={port} adapterId={selectedProvider} label={adapter.name} adapter={adapter} />
        </>
      )}
    </div>
  );
}
