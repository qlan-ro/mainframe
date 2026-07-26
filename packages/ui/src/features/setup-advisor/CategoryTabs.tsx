/**
 * Category tab strip — one tab per category with at least one recommendation,
 * always in canonical order (mcp, skills, hooks, subagents, plugins)
 * regardless of the input array's order, each carrying a count badge.
 */
import { cn } from '@/lib/utils';
import type { AutomationRecommendation, RecommendationCategory } from '@qlan-ro/mainframe-types';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER } from './categories';

interface CategoryTabsProps {
  recommendations: AutomationRecommendation[];
  active: RecommendationCategory;
  onSelect: (category: RecommendationCategory) => void;
}

function countByCategory(recommendations: AutomationRecommendation[]): Map<RecommendationCategory, number> {
  const counts = new Map<RecommendationCategory, number>();
  for (const rec of recommendations) {
    counts.set(rec.category, (counts.get(rec.category) ?? 0) + 1);
  }
  return counts;
}

export function CategoryTabs({ recommendations, active, onSelect }: CategoryTabsProps) {
  const counts = countByCategory(recommendations);
  const present = CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0);

  return (
    <div className="flex shrink-0 gap-4 border-b border-border px-4">
      {present.map((category) => {
        const Icon = CATEGORY_ICON[category];
        const isActive = category === active;
        return (
          <button
            key={category}
            type="button"
            data-testid={`automation-recommender-tab-${category}`}
            onClick={() => onSelect(category)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 py-2 text-body transition-colors',
              isActive
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon size={14} />
            {CATEGORY_LABEL[category]}
            <span className="rounded-full bg-muted px-1.5 text-caption tabular-nums">{counts.get(category)}</span>
          </button>
        );
      })}
    </div>
  );
}
