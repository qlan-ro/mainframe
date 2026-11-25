import { useSettingsStore } from '../../store/settings';
import { GeneralPane } from './panes/general/GeneralPane';
import { ChatPane } from './panes/chat/ChatPane';
import { NotificationsPane } from './panes/notifications/NotificationsPane';
import { AboutPane } from './panes/about/AboutPane';
import { ProvidersPane } from './panes/providers/ProvidersPane';
import { RemoteAccessPane } from './panes/remote-access/RemoteAccessPane';
import { KeybindingsPane } from './panes/keybindings/KeybindingsPane';
import { ExternalClientsPane } from './panes/external-clients/ExternalClientsPane';

export function SettingsContent({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  switch (activeTab) {
    case 'general':
      return <GeneralPane port={port} />;
    case 'chat':
      return <ChatPane />;
    case 'providers':
      return <ProvidersPane port={port} />;
    case 'keybindings':
      return <KeybindingsPane />;
    case 'notifications':
      return <NotificationsPane port={port} />;
    case 'remote-access':
      return <RemoteAccessPane port={port} />;
    case 'external-clients':
      return <ExternalClientsPane port={port} />;
    case 'about':
      return <AboutPane />;
  }
}
