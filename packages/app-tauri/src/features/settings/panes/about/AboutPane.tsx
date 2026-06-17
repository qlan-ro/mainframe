import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getAppInfo, type AppInfo } from '../../../../lib/tauri/bridge';

interface AboutRow {
  label: string;
  value: string;
  testId: string;
  mono: boolean;
}

export function AboutPane() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getAppInfo()
      .then(setInfo)
      .catch((err: unknown) => console.warn('[settings/AboutPane]', err));
  }, []);

  const rows: AboutRow[] = [
    { label: 'Version', value: info?.version ?? '—', testId: 'settings-about-version', mono: true },
    { label: 'Author', value: info?.author ?? '—', testId: 'settings-about-author', mono: false },
    { label: 'Home directory', value: info?.homedir ?? '—', testId: 'settings-about-homedir', mono: true },
  ];

  return (
    <div data-testid="settings-pane-about">
      <div className="mb-6 flex items-center gap-3.5">
        <div className="inline-flex size-[52px] shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,var(--primary),oklch(0.62_0.23_304))] text-hero font-extrabold text-white shadow-md">
          m
        </div>
        <div className="min-w-0">
          <div className="text-display font-bold tracking-tight text-foreground">Mainframe</div>
          <div className="text-label text-muted-foreground">AI-native development environment</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border-[0.5px] border-border">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={cn(
              'flex items-center gap-4 px-3.5 py-[11px]',
              i < rows.length - 1 && 'border-b-[0.5px] border-border',
            )}
          >
            <span className="w-20 shrink-0 text-label text-mf-text-3">{row.label}</span>
            <span
              data-testid={row.testId}
              className={cn('min-w-0 truncate text-label text-foreground', row.mono && 'font-mono')}
              title={row.value}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
