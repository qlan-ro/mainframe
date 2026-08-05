/**
 * NewBranchDialog — name input + start-point select for creating a new branch.
 * BRANCH_NAME_RE ported verbatim from desktop NewBranchDialog.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Input } from '@v2/components/ui/input';
import { Label } from '@v2/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@v2/components/ui/select';

export const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export interface NewBranchDialogProps {
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  startFrom?: string;
  onBack: () => void;
  onCreate: (name: string, startPoint: string) => Promise<void>;
}

function validate(name: string, localBranches: string[]): string | null {
  if (!name.trim()) return 'Branch name is required';
  if (!BRANCH_NAME_RE.test(name)) return 'Invalid branch name';
  if (localBranches.includes(name)) return 'Branch already exists';
  return null;
}

export function NewBranchDialog({
  localBranches,
  remoteBranches,
  currentBranch,
  startFrom,
  onBack,
  onCreate,
}: NewBranchDialogProps) {
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState(startFrom ?? currentBranch);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const err = validate(name, localBranches);
    if (err) {
      setError(err);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(name.trim(), startPoint);
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  }

  return (
    <div data-testid="git-new-branch-dialog" className="min-w-[280px]">
      <div className="-mx-1 flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <Button
          data-testid="git-new-branch-back"
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          className="size-5 text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="text-sm font-medium text-foreground">New Branch</span>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-2 pt-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="git-new-branch-name" className="text-xs text-muted-foreground">
            Branch name
          </Label>
          <Input
            id="git-new-branch-name"
            data-testid="git-new-branch-name"
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="feature/my-branch"
            disabled={creating}
            aria-invalid={error ? true : undefined}
            className="h-8 font-mono text-sm"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Start from</Label>
          <Select value={startPoint} onValueChange={setStartPoint} disabled={creating}>
            <SelectTrigger data-testid="git-new-branch-start" size="sm" className="w-full font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectLabel>Local</SelectLabel>
                {localBranches.map((b) => (
                  <SelectItem key={b} value={b} data-testid={`git-new-branch-start-option-${b}`} className="font-mono">
                    {b}
                  </SelectItem>
                ))}
              </SelectGroup>
              {remoteBranches.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Remote</SelectLabel>
                  {remoteBranches.map((b) => (
                    <SelectItem
                      key={b}
                      value={b}
                      data-testid={`git-new-branch-start-option-${b}`}
                      className="font-mono"
                    >
                      {b}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            data-testid="git-new-branch-cancel"
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button data-testid="git-new-branch-create" type="submit" size="sm" disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="size-3 animate-spin" /> : 'Create'}
          </Button>
        </div>
      </form>
    </div>
  );
}
