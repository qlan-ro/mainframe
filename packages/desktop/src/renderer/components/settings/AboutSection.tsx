import React, { useEffect, useState } from 'react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:settings');

type AppInfo = Awaited<ReturnType<typeof window.mainframe.getAppInfo>>;

export function AboutSection(): React.ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.mainframe
      .getAppInfo()
      .then(setInfo)
      .catch((err: unknown) => log.warn('failed to load app info', { err: String(err) }));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-mf-heading font-semibold text-mf-text-primary mb-4">Mainframe</h3>
        <p className="text-mf-body text-mf-text-secondary">AI-native development environment</p>
      </div>

      <div className="space-y-2">
        <Row label="Version" value={info?.version ?? '—'} />
        <Row label="Author" value={info?.author ?? '—'} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-4">
      <span className="w-16 text-mf-small text-mf-text-secondary shrink-0">{label}</span>
      <span className="text-mf-small text-mf-text-primary">{value}</span>
    </div>
  );
}
