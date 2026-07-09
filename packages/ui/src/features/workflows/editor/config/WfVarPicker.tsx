/**
 * WfVarPicker — flat, source-grouped, searchable magic-variable list.
 * See docs/plans/2026-07-09-workflow-step-config-plan.md Task 18.
 *
 * `answer` sources (form-step answer keys) are grouped under "Step outputs"
 * alongside `step` sources — both describe values produced by an earlier
 * step, just at different depths.
 */
import { useMemo } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { slug } from '../wf-slug';
import type { WfScopeSource } from './wf-scope';

export interface WfVarPickerProps {
  scope: WfScopeSource[];
  onPick: (source: WfScopeSource) => void;
}

const GROUP_LABEL: Record<WfScopeSource['kind'], string> = {
  step: 'Step outputs',
  answer: 'Step outputs',
  input: 'Inputs',
  var: 'Vars',
  loop: 'Loop',
};

const GROUP_ORDER = ['Step outputs', 'Inputs', 'Vars', 'Loop'] as const;

function groupByLabel(scope: WfScopeSource[]): Map<string, WfScopeSource[]> {
  const groups = new Map<string, WfScopeSource[]>();
  for (const source of scope) {
    const label = GROUP_LABEL[source.kind];
    const list = groups.get(label);
    if (list) list.push(source);
    else groups.set(label, [source]);
  }
  return groups;
}

export function WfVarPicker({ scope, onPick }: WfVarPickerProps): React.ReactElement {
  const groups = useMemo(() => groupByLabel(scope), [scope]);

  return (
    <Command data-testid="workflows-varpicker" className="rounded-md">
      <CommandInput data-testid="workflows-varpicker-search" placeholder="Search variables..." />
      <CommandList>
        <CommandEmpty>No variables found.</CommandEmpty>
        {GROUP_ORDER.filter((label) => groups.has(label)).map((label) => (
          <CommandGroup key={label} heading={label}>
            {groups.get(label)!.map((source) => (
              <CommandItem
                key={source.expr}
                value={`${source.label} ${source.expr}`}
                data-testid={`workflows-varpicker-${slug(source.expr)}`}
                onSelect={() => onPick(source)}
              >
                {source.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
