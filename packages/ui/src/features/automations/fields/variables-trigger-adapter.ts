/**
 * Trigger adapter for the `$` variable picker — search-first over the
 * namespace assigned to a scope (`buildVariableNamespace(scopeAt(...))`).
 *
 * Search matches a variable-name PREFIX only, never a label/description
 * substring. `$`, unlike `/`'s skills or `@`'s files, opens on any ordinary
 * word start — real prompt text hits this constantly ("costs $5", "$HOME",
 * "$(pwd)"). A substring-fuzzy match across name/label/description (the
 * `skills-trigger-adapter.ts` pattern) would surface spurious matches for
 * those tokens; a name-prefix match does not, because `sanitizeVariableName`
 * never produces a name starting with a digit or paren, and still lists
 * everything on an empty query (bare `$` browse-all).
 */
import { buildVariableNamespace, type TokenDescriptor } from '@qlan-ro/mainframe-types';
import type { TriggerAdapter, TriggerItem } from '@/components/trigger-engine/types';

function toItem(name: string, descriptor: TokenDescriptor): TriggerItem {
  return { id: name, type: 'variable', label: `$${name}`, description: descriptor.source };
}

export function buildVariablesTriggerAdapter(scope: TokenDescriptor[]): TriggerAdapter {
  const namespace = buildVariableNamespace(scope);
  const items = Array.from(namespace.byName.entries()).map(([name, descriptor]) => toItem(name, descriptor));
  return {
    categories: () => [],
    categoryItems: () => items,
    search: (query) => {
      const needle = query.toLowerCase();
      return items.filter((item) => item.id.toLowerCase().startsWith(needle));
    },
  };
}
