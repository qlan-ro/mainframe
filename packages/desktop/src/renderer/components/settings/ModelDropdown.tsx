import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function ModelDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = options.find((o) => o.id === value);

  return (
    <div className="space-y-1.5">
      <label className="text-mf-small text-mf-text-secondary">Default Model</label>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between bg-mf-input-bg border border-mf-border rounded-mf-input px-3 py-1.5 text-mf-small text-mf-text-primary hover:border-mf-accent focus:outline-none focus:border-mf-accent cursor-pointer transition-colors"
        >
          <span>{selected?.label ?? value}</span>
          <ChevronDown size={14} className="text-mf-text-secondary" />
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg z-50 overflow-hidden">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-mf-small transition-colors ${
                  opt.id === value
                    ? 'text-mf-text-primary bg-mf-hover'
                    : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
