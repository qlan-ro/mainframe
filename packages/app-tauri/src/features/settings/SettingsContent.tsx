import { useSettingsStore } from '../../store/settings';
import { GeneralPane } from './panes/general/GeneralPane';
import { NotificationsPane } from './panes/notifications/NotificationsPane';
import { AboutPane } from './panes/about/AboutPane';
import { ProvidersPane } from './panes/providers/ProvidersPane';

function Stub({ id }: { id: string }) {
  return (
    <div data-testid={`settings-pane-${id}`} className="text-mf-text-secondary">
      {id} — coming soon
    </div>
  );
}

export function SettingsContent({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  switch (activeTab) {
    case 'general':
      return <GeneralPane port={port} />;
    case 'providers':
      return <ProvidersPane port={port} />;
    case 'notifications':
      return <NotificationsPane port={port} />;
    case 'remote-access':
      return <Stub id="remote-access" />;
    case 'about':
      return <AboutPane />;
  }
}
