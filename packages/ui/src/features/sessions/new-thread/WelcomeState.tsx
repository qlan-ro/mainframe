/**
 * WelcomeState — the draft empty-state: a headline and up to 3 repo-derived
 * suggestion rows that pre-fill the composer. The "FROM THE REPO" section
 * renders only when suggestions exist.
 *
 * The project and the branch are chosen in the strip above the composer (K3).
 * Until a project is picked the screen says so, with no suggestions, and the
 * composer itself stays hidden: the first send needs a project to create the
 * chat in.
 */
import { useAui } from '@assistant-ui/react';
import { useRepoSuggestions } from './use-repo-suggestions';
import { SuggestionRow } from './SuggestionRow';

export function WelcomeState({ projectId }: { projectId?: string | null }) {
  const aui = useAui();
  const { suggestions } = useRepoSuggestions(projectId ?? null);
  const insert = (prefill: string) => aui.composer.setText(prefill);

  return (
    // Fill the scroll area and center the column vertically + horizontally (spec
    // Change 4: "min-height 100% of the scroll area, so it scrolls on short panes").
    <div data-testid="sessions-welcome" className="flex min-h-full flex-col justify-center py-10">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-foreground">What should we take on?</h1>
          <p className="text-sm text-muted-foreground">
            {/* undefined = nothing resolved yet; null ("No project") and a real
                project id both count as a made choice (spec: "No project" counts
                as a choice"). */}
            {projectId !== undefined
              ? 'Describe a task, or pick a starting point below.'
              : 'Choose a project to get started.'}
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium text-muted-foreground">From the repo</div>
            {suggestions.map((s, i) => (
              <SuggestionRow key={`${s.icon}-${s.title}`} suggestion={s} index={i} onInsert={insert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
