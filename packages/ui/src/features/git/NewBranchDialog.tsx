/**
 * NewBranchDialog — name input + start-point select for creating a new branch,
 * as a v2 Dialog (opened from the branch menu's "New branch…" item — forms
 * don't live inside Radix menus). BRANCH_NAME_RE ported verbatim from desktop.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export interface NewBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localBranches: string[];
  remoteBranches: string[];
  currentBranch: string;
  startFrom?: string;
  onCreate: (name: string, startPoint: string) => Promise<void>;
}

function validate(name: string, localBranches: string[]): string | null {
  if (!name.trim()) return 'Branch name is required';
  if (!BRANCH_NAME_RE.test(name)) return 'Invalid branch name';
  if (localBranches.includes(name)) return 'Branch already exists';
  return null;
}

export function NewBranchDialog({
  open,
  onOpenChange,
  localBranches,
  remoteBranches,
  currentBranch,
  startFrom,
  onCreate,
}: NewBranchDialogProps) {
  const [name, setName] = useState('');
  const [startPoint, setStartPoint] = useState(startFrom ?? currentBranch);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh form every open — the dialog stays mounted across uses.
  useEffect(() => {
    if (!open) return;
    setName('');
    setStartPoint(startFrom ?? currentBranch);
    setCreating(false);
    setError(null);
  }, [open, startFrom, currentBranch]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="git-new-branch-dialog" className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Branch</DialogTitle>
          <DialogDescription className="sr-only">Create a new branch from an existing start point.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="git-new-branch-name">Branch name</Label>
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
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Start from</Label>
            <Select value={startPoint} onValueChange={setStartPoint} disabled={creating}>
              <SelectTrigger data-testid="git-new-branch-start" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectLabel>Local</SelectLabel>
                  {localBranches.map((b) => (
                    <SelectItem key={b} value={b} data-testid={`git-new-branch-start-option-${b}`}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {remoteBranches.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Remote</SelectLabel>
                    {remoteBranches.map((b) => (
                      <SelectItem key={b} value={b} data-testid={`git-new-branch-start-option-${b}`}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              data-testid="git-new-branch-cancel"
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button data-testid="git-new-branch-create" type="submit" disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="size-3 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
