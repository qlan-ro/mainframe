import React from 'react';
import { Button } from '../ui/button';
import { AlertCircle } from 'lucide-react';

interface ReviewPanelHeaderProps {
  isWorktree: boolean;
  onClose: () => void;
  filename?: string | null;
  mode?: 'inline' | 'split';
  onModeChange?: (mode: 'inline' | 'split') => void;
}

export const ReviewPanelHeader: React.FC<ReviewPanelHeaderProps> = ({
  isWorktree,
  onClose,
  filename,
  mode,
  onModeChange,
}) => {
  return (
    <div className="border-b border-mf-border">
      {/* Title bar: [title] [centered filename] [mode toggle | close] */}
      <div className="relative flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-mf-text-primary">Review Changes</h2>

        {filename && (
          <div className="pointer-events-none absolute inset-x-0 flex justify-center">
            <span className="truncate font-mono text-sm text-mf-text-secondary" title={filename}>
              {filename}
            </span>
          </div>
        )}

        <div className="relative flex items-center gap-2">
          {mode && onModeChange && (
            <div className="flex items-center gap-1">
              <ModeButton active={mode === 'inline'} onClick={() => onModeChange('inline')} label="inline">
                ≣ Inline
              </ModeButton>
              <ModeButton active={mode === 'split'} onClick={() => onModeChange('split')} label="side-by-side">
                ⇄ Split
              </ModeButton>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            data-testid="review-button-close"
            onClick={onClose}
            aria-label="Close review panel"
            className="hover:bg-mf-hover"
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Warning banner (only if not worktree) */}
      {!isWorktree && (
        <div className="flex gap-3 border-t border-mf-border bg-mf-hover px-6 py-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-mf-warning" />
          <p className="text-sm text-mf-text-secondary">
            Changes are not isolated to this chat. Review includes all uncommitted work in the project.
          </p>
        </div>
      )}
    </div>
  );
};

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}

/** Bordered toggle in the header — mirrors tabs.tsx active/inactive pattern, sized for app-bg chrome. */
const ModeButton: React.FC<ModeButtonProps> = ({ active, onClick, label, children }) => (
  <button
    type="button"
    data-testid={`review-button-mode-${label}`}
    onClick={onClick}
    aria-pressed={active}
    aria-label={`Switch to ${label} diff view`}
    className={`h-7 rounded-mf-input border px-2.5 text-mf-small font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-mf-ring ${
      active
        ? 'border-mf-border bg-mf-hover text-mf-text-primary'
        : 'border-mf-border/60 bg-transparent text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
    }`}
  >
    {children}
  </button>
);
