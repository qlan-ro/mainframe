export function SelectorBreadcrumb({ path }: { path: string }) {
  const parts = path
    .split(' > ')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const lastIndex = parts.length - 1;
  return (
    <div className="flex flex-wrap items-center">
      {parts.map((p, i) => {
        const isTarget = i === lastIndex;
        return (
          <span
            key={`${p}-${i}`}
            data-testid="selector-crumb"
            data-crumb={isTarget ? 'target' : 'ancestor'}
            className={[
              'relative inline-flex items-center text-[11px] font-mono py-0.5 pr-2.5',
              isTarget ? 'bg-mf-accent text-mf-panel-bg' : 'bg-mf-hover text-mf-text-secondary',
            ].join(' ')}
            style={{
              paddingLeft: i === 0 ? '0.5rem' : '0.875rem',
              marginLeft: i === 0 ? 0 : -8,
              clipPath:
                i === 0
                  ? 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)'
                  : 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%)',
            }}
          >
            {p}
          </span>
        );
      })}
    </div>
  );
}
