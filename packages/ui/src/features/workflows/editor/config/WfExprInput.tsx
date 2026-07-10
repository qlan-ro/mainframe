/**
 * WfExprInput — magic-variable aware expr field for workflow step config
 * forms (Task 17/18). The document value IS the plain `${...}` string;
 * chips (see wf-expr-chips.ts) are a view-only decoration layer.
 *
 * The CodeMirror mount (`WfExprInputEditor`) is lazy-loaded (React.lazy +
 * Suspense) — plain (non-expr) config forms never pay for the CodeMirror
 * bundle. Insertion (⊕ button, typing `${`, or the chip raw-edit box) is
 * done as plain string surgery on `value`, so it works even while the CM6
 * chunk is still loading.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { WfVarPicker } from './WfVarPicker';
import type { WfScopeSource } from './wf-scope';

const WfExprInputEditor = lazy(() => import('./WfExprInputEditor').then((m) => ({ default: m.WfExprInputEditor })));

export interface WfExprInputProps {
  value: string;
  onChange: (value: string) => void;
  scope: WfScopeSource[];
  multiline?: boolean;
  testId: string;
}

interface ChipEdit {
  from: number;
  to: number;
  text: string;
  /** `value` at click time — the editor stays editable while this box is open, so
   * from/to can go stale; a mismatch here means the field moved on underneath us. */
  valueSnapshot: string;
}

function EditorFallback({ multiline, testId }: { multiline?: boolean; testId: string }): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={cn('rounded-md border-[0.5px] border-input bg-card', multiline ? 'min-h-[80px]' : 'h-8')}
    />
  );
}

/** Did the user just type the opening `${` of a new expression at `cursor`? */
function justOpenedExpr(prev: string, next: string, cursor: number): boolean {
  return next.length === prev.length + 1 && cursor >= 2 && next.slice(cursor - 2, cursor) === '${';
}

export function WfExprInput({ value, onChange, scope, multiline, testId }: WfExprInputProps): React.ReactElement {
  const cursorRef = useRef(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cursorHint, setCursorHint] = useState<number | undefined>(undefined);
  const [chipEdit, setChipEdit] = useState<ChipEdit | null>(null);

  function handleEditorChange(next: string, cursor: number): void {
    const prev = value;
    cursorRef.current = cursor;
    onChange(next);
    if (justOpenedExpr(prev, next, cursor)) setPickerOpen(true);
  }

  function insertAtCursor(text: string): void {
    const pos = Math.min(cursorRef.current, value.length);
    onChange(value.slice(0, pos) + text + value.slice(pos));
    setCursorHint(pos + text.length);
  }

  function handlePick(source: WfScopeSource): void {
    insertAtCursor(source.expr);
    setPickerOpen(false);
  }

  function handleChipClick(from: number, to: number): void {
    setChipEdit({ from, to, text: value.slice(from, to), valueSnapshot: value });
  }

  // The main editor stays live while the chip-edit box is open; if `value`
  // moved on underneath it, from/to no longer point at the clicked chip —
  // close the box rather than splice at stale offsets.
  useEffect(() => {
    if (chipEdit && chipEdit.valueSnapshot !== value) setChipEdit(null);
  }, [value, chipEdit]);

  function saveChipEdit(): void {
    if (!chipEdit || chipEdit.valueSnapshot !== value) {
      setChipEdit(null);
      return;
    }
    onChange(value.slice(0, chipEdit.from) + chipEdit.text + value.slice(chipEdit.to));
    setCursorHint(chipEdit.from + chipEdit.text.length);
    setChipEdit(null);
  }

  return (
    <div className="space-y-[6px]">
      <div className="flex items-start gap-[6px]">
        <div className="flex-1">
          <Suspense fallback={<EditorFallback multiline={multiline} testId={testId} />}>
            <WfExprInputEditor
              value={value}
              onChange={handleEditorChange}
              scope={scope}
              multiline={multiline}
              testId={testId}
              onChipClick={handleChipClick}
              cursorHint={cursorHint}
              onCursorHintConsumed={() => setCursorHint(undefined)}
            />
          </Suspense>
        </div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Insert variable"
              data-testid={`${testId}-insert-var`}
            >
              <Plus size={13} aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="end">
            <WfVarPicker scope={scope} onPick={handlePick} />
          </PopoverContent>
        </Popover>
      </div>

      {chipEdit && (
        <div className="flex items-center gap-[6px]" data-testid={`${testId}-chip-edit`}>
          <Input
            data-testid={`${testId}-chip-edit-input`}
            value={chipEdit.text}
            onChange={(e) => setChipEdit({ ...chipEdit, text: e.target.value })}
            className="flex-1 font-mono text-caption"
          />
          <Button type="button" size="sm" data-testid={`${testId}-chip-edit-save`} onClick={saveChipEdit}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`${testId}-chip-edit-cancel`}
            onClick={() => setChipEdit(null)}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
