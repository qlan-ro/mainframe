/**
 * ReviewScopeSwitcher — Session · Uncommitted · Branch, in the modal header.
 *
 * The inspector's Changes tab used to be the only surface offering the three
 * change scopes; it retires into the session panel, so the scopes land here.
 *
 * v2 renders an exclusive one-of-N switch as Tabs List+Trigger with no
 * TabsContent — the panel each segment reveals is the modal's own body, which
 * ReviewPanel owns. `activationMode="manual"` because `onScopeChange` refetches:
 * automatic activation also fires on focus, which would fetch a scope the user
 * only arrowed past.
 */
import { Tabs, TabsList, TabsTrigger } from '@v2/components/ui/tabs';
import type { ChangeScope } from './use-working-changes';
import { SCOPE_OPTIONS } from './review-scope-view';

interface ReviewScopeSwitcherProps {
  scope: ChangeScope;
  onScopeChange: (scope: ChangeScope) => void;
}

export function ReviewScopeSwitcher({ scope, onScopeChange }: ReviewScopeSwitcherProps) {
  return (
    <Tabs
      value={scope}
      onValueChange={(next) => onScopeChange(next as ChangeScope)}
      activationMode="manual"
      className="shrink-0"
    >
      {/* Compacted to the header row by re-declaring the primitive's own group
          modifier — a bare `h-7` would stack with it rather than replace it. */}
      <TabsList aria-label="Change scope" className="gap-px rounded-md p-0.5 group-data-horizontal/tabs:h-7">
        {SCOPE_OPTIONS.map((option) => (
          <TabsTrigger key={option.id} value={option.id} data-testid={`review-scope-${option.id}`} className="px-2.5">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
