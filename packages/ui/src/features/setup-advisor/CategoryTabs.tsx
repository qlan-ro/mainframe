/**
 * Category tab strip — one tab per category with at least one recommendation,
 * always in canonical order (mcp, skills, hooks, subagents, plugins)
 * regardless of the input array's order, each carrying a count badge.
 */
import { Badge } from '@v2/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@v2/components/ui/tabs';
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
    <Tabs
      value={active}
      onValueChange={(v) => onSelect(v as RecommendationCategory)}
      className="shrink-0 border-b px-4 pb-2"
    >
      <TabsList className="h-8">
        {present.map((category) => {
          const Icon = CATEGORY_ICON[category];
          return (
            <TabsTrigger key={category} value={category} data-testid={`automation-recommender-tab-${category}`}>
              <Icon size={14} />
              {CATEGORY_LABEL[category]}
              <Badge variant="secondary" className="px-1 py-0 text-xs tabular-nums">
                {counts.get(category)}
              </Badge>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
