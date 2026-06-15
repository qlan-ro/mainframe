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
        <h3 className="text-heading font-medium text-foreground">About Mainframe</h3>

        <div className="flex flex-col gap-2 text-body">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Version</span>
            <span data-testid="settings-about-version" className="text-foreground font-mono">
              {info !== null ? info.version : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Author</span>
            <span data-testid="settings-about-author" className="text-foreground">
              {info !== null ? info.author : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Home directory</span>
            <span
              data-testid="settings-about-homedir"
              className="text-foreground font-mono text-label truncate max-w-[220px]"
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
