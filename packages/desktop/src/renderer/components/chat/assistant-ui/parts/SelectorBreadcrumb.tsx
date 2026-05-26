import { ScrollRow } from '../../../ui/scroll-row';

const MAX_SEGMENTS = 3;

interface SelectorBreadcrumbProps {
  path: string;
  /**
   * Background color the scroll-row's fade-edge mask blends into. Must match
   * the breadcrumb's surrounding surface. The breadcrumb is rendered on
   * multiple surfaces (panel-bg in the composer, hover-bg inside user message
   * bubbles), so the caller must specify.
   */
  fadeColor?: string;
}

export function SelectorBreadcrumb({ path, fadeColor }: SelectorBreadcrumbProps) {
  const raw = path
    .split(' > ')
    .map((p) => p.trim())
    .filter(Boolean);
  if (raw.length === 0) return null;
  const parts = raw.length > MAX_SEGMENTS ? ['…', ...raw.slice(-MAX_SEGMENTS)] : raw;
  const lastIndex = parts.length - 1;
  return (
    <ScrollRow data-testid="selector-breadcrumb" className="flex-1 min-w-0" fadeColor={fadeColor}>
      <div className="flex items-center shrink-0" title={path}>
        {parts.map((p, i) => {
          const isTarget = i === lastIndex;
          return (
            <span
              key={`${p}-${i}`}
              data-testid="selector-crumb"
              data-crumb={isTarget ? 'target' : 'ancestor'}
              className={[
                'relative inline-flex items-center text-[11px] font-mono py-0.5 pr-2.5 shrink-0',
                isTarget ? 'bg-mf-accent text-mf-panel-bg' : 'bg-mf-panel-bg text-mf-text-secondary',
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
    </ScrollRow>
  );
}
