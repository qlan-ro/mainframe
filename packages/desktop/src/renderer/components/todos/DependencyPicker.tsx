import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Todo } from '../../lib/api/todos-api';

interface Props {
  currentId?: string;
  currentNumber?: number;
  allTodos: Todo[];
  value: number[];
  onChange: (v: number[]) => void;
  inputClass: string;
}

export function DependencyPicker({
  currentId,
  currentNumber,
  allTodos,
  value,
  onChange,
  inputClass,
}: Props): React.ReactElement {
  const available = allTodos.filter((t) => t.id !== currentId && !value.includes(t.number));
  const selected = allTodos.filter((t) => value.includes(t.number));

  const addDep = (numStr: string) => {
    const num = parseInt(numStr, 10);
    if (!isNaN(num) && !value.includes(num)) onChange([...value, num]);
  };

  const removeDep = (num: number) => onChange(value.filter((n) => n !== num));

  return (
    <div className="flex flex-col gap-1">
      <label className="text-mf-small text-mf-text-secondary">Depends on</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((t) => (
            <span
              key={t.number}
              className="flex items-center gap-1 bg-mf-hover px-1.5 py-0.5 rounded text-mf-status text-mf-text-secondary"
            >
              #{t.number} {t.title.length > 24 ? t.title.slice(0, 24) + '…' : t.title}
              <button
                type="button"
                onClick={() => removeDep(t.number)}
                className="hover:text-mf-text-primary transition-colors"
                aria-label={`Remove dependency on #${t.number}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <select
          className={cn(inputClass, 'cursor-pointer')}
          value=""
          onChange={(e) => addDep(e.target.value)}
          aria-label="Add dependency"
        >
          <option value="" disabled>
            Add dependency…
          </option>
          {available.map((t) => (
            <option key={t.number} value={t.number}>
              #{t.number} {t.title}
            </option>
          ))}
        </select>
      )}
      {currentNumber === undefined && available.length === 0 && value.length === 0 && (
        <span className="text-mf-status text-mf-text-secondary opacity-60">No other tasks available</span>
      )}
    </div>
  );
}
