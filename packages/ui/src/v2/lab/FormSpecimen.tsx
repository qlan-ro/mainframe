/**
 * The worktree popover, rebuilt on the v2 primitives.
 *
 * It exists to put Select / Input / Button side by side under the v2 tokens,
 * so a change to the token layer has one place that shows it. Everything here
 * is stock: no arbitrary [Npx] spacing, no custom shadow, no named type rungs.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Input } from '@v2/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@v2/components/ui/select';

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

const GROUP = 'flex flex-col gap-1.5';
const LABEL = 'text-sm font-medium text-muted-foreground';

export function FormSpecimen() {
  const [baseBranch, setBaseBranch] = useState(CURRENT);
  const [branchName, setBranchName] = useState('');

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Worktree popover</h2>
        <p className="max-w-[70ch] text-xs text-muted-foreground">
          Stock <code className="font-mono">Select</code> / <code className="font-mono">Input</code> /{' '}
          <code className="font-mono">Button</code> from the radix-vega registry, unmodified. The base-branch list
          scrolls with chevrons instead of a scrollbar because it&apos;s a Select, not a Popover with{' '}
          <code className="font-mono">overflow-y-auto</code>.
        </p>
      </header>

      <div className="w-[280px] rounded-xl border bg-popover p-4 shadow-sm">
        <div className="flex flex-col gap-4">
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
