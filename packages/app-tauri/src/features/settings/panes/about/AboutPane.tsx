import { useState, useEffect } from 'react';
import { getAppInfo, type AppInfo } from '../../../../lib/tauri/bridge';

export function AboutPane() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getAppInfo()
      .then(setInfo)
      .catch((err: unknown) => console.warn('[settings/AboutPane]', err));
  }, []);

  return (
    <div data-testid="settings-pane-about" className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-medium text-mf-text-primary">About Mainframe</h3>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-mf-text-secondary">Version</span>
            <span data-testid="settings-about-version" className="text-mf-text-primary font-mono">
              {info !== null ? info.version : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-mf-text-secondary">Author</span>
            <span data-testid="settings-about-author" className="text-mf-text-primary">
              {info !== null ? info.author : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-mf-text-secondary">Home directory</span>
            <span
              data-testid="settings-about-homedir"
              className="text-mf-text-primary font-mono text-xs truncate max-w-[220px]"
              title={info !== null ? info.homedir : undefined}
            >
              {info !== null ? info.homedir : '—'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
