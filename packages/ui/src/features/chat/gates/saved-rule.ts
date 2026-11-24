/**
 * What "Always allow" saves, in the words of the rule itself (G2), or null
 * when the CLI suggested none. `Bash(cargo test *)` reads `cargo test *`; a
 * rule for the whole tool reads as the tool's name.
 */
import type { ControlUpdate } from '@qlan-ro/mainframe-types';

export function savedRule(suggestions: readonly ControlUpdate[] | undefined): string | null {
  for (const suggestion of suggestions ?? []) {
    if (suggestion.type !== 'addRules' && suggestion.type !== 'replaceRules') continue;
    const rule = suggestion.rules[0];
    if (rule) return rule.ruleContent?.trim() || rule.toolName;
  }
  return null;
}
