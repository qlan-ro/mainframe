/**
 * Category metadata for the Setup Advisor sheet: canonical tab order, the
 * icon/label used per category, the footer copy (plugins run inside Claude
 * Code, everything else runs in a terminal), and the first-present-category
 * helper that seeds the sheet's active tab.
 */
import { Plug, Sparkles, Webhook, Bot, Puzzle, type LucideIcon } from 'lucide-react';
import type { AutomationRecommendation, RecommendationCategory } from '@qlan-ro/mainframe-types';

export const CATEGORY_ORDER: RecommendationCategory[] = ['mcp', 'skills', 'hooks', 'subagents', 'plugins'];

export const CATEGORY_ICON: Record<RecommendationCategory, LucideIcon> = {
  mcp: Plug,
  skills: Sparkles,
  hooks: Webhook,
  subagents: Bot,
  plugins: Puzzle,
};

export const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  mcp: 'MCP',
  skills: 'Skills',
  hooks: 'Hooks',
  subagents: 'Subagents',
  plugins: 'Plugins',
};

export const CATEGORY_FOOTER_TEXT: Record<RecommendationCategory, string> = {
  mcp: 'Read-only — commands run in your terminal.',
  skills: 'Read-only — commands run in your terminal.',
  hooks: 'Read-only — commands run in your terminal.',
  subagents: 'Read-only — commands run in your terminal.',
  plugins: 'Read-only — run this inside Claude Code.',
};

export function firstPresentCategory(recommendations: AutomationRecommendation[]): RecommendationCategory {
  for (const category of CATEGORY_ORDER) {
    if (recommendations.some((rec) => rec.category === category)) return category;
  }
  return 'mcp';
}
