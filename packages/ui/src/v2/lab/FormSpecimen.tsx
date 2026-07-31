/**
 * The popover from the original complaint, rendered with shipped primitives
 * under v2 tokens — no v2-specific markup at all.
 *
 * That's the point of the exercise: Select/Input/Button are untouched imports
 * from @/components/ui, so everything that changes here is the token layer. The
 * grouping rhythm comes out of the scale rather than being hand-set in [Npx]
 * arbitraries, which is what the shipped form does.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const BRANCHES = [
  'feat/macos-permissions',
  'main',
  'proto/233-workflow-details-view',
  'proto/286-github-issues-sync',
  'todo/233-workflow-details-cluster',
  'todo/240-mention-other-sessions',
  'todo/281-preview-open-urls',
];

const CURRENT = 'main';

/** 6px label→control, 18px group→group. Both land on the scale now: gap-1.5 and gap-4.5. */
const GROUP = 'flex flex-col gap-1.5';
const LABEL = 'text-body font-medium text-muted-foreground';

export function FormSpecimen() {
  const [baseBranch, setBaseBranch] = useState(CURRENT);
  const [branchName, setBranchName] = useState('');

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-heading font-semibold text-foreground">Worktree popover</h2>
        <p className="max-w-[70ch] text-caption text-muted-foreground">
          Stock <code className="font-mono">Select</code> / <code className="font-mono">Input</code> /{' '}
          <code className="font-mono">Button</code> imported unchanged from the shipped app. Only the tokens differ. The
          base-branch list scrolls with chevrons instead of a scrollbar because it's a Select, not a Popover with{' '}
          <code className="font-mono">overflow-y-auto</code>.
        </p>
      </header>

      <div className="w-[280px] rounded-lg border border-border bg-popover p-3.5 shadow-[var(--mf-shadow-pop)]">
        <div className="flex flex-col gap-4.5">
          <div className={GROUP}>
            <label className={LABEL} htmlFor="v2-base-branch">
              Base branch
            </label>
            <Select value={baseBranch} onValueChange={setBaseBranch}>
              <SelectTrigger id="v2-base-branch" data-testid="v2-worktree-base-branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRANCHES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b === CURRENT ? `${b} (current)` : b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className={GROUP}>
            <label className={LABEL} htmlFor="v2-branch-name">
              Branch name
            </label>
            <Input
              id="v2-branch-name"
              data-testid="v2-worktree-branch-name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feat/my-branch"
              autoComplete="off"
              className="font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="sm" data-testid="v2-worktree-cancel">
              Cancel
            </Button>
            <Button size="sm" data-testid="v2-worktree-enable">
              <Check />
              Enable
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
