import { useSettingsStore } from '../../store/settings';

function Stub({ id }: { id: string }) {
  return (
    <div data-testid={`settings-pane-${id}`} className="text-mf-text-secondary">
      {id} — coming soon
    </div>
  );
}

export function SettingsContent({ port }: { port: number }) {
  const activeTab = useSettingsStore((s) => s.activeTab);
  void port; // panes consume it once implemented
  switch (activeTab) {
    case 'general':
      return <Stub id="general" />;
    case 'providers':
      return <Stub id="providers" />;
    case 'notifications':
      return <Stub id="notifications" />;
    case 'remote-access':
      return <Stub id="remote-access" />;
    case 'about':
      return <Stub id="about" />;
  }
}
