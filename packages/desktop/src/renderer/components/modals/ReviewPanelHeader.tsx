import React from 'react';
import { Button } from '../ui/button';
import { AlertCircle } from 'lucide-react';

interface ReviewPanelHeaderProps {
  isWorktree: boolean;
  onClose: () => void;
}

export const ReviewPanelHeader: React.FC<ReviewPanelHeaderProps> = ({ isWorktree, onClose }) => {
  return (
    <div className="border-b border-mf-border">
      {/* Title bar */}
      <div className="flex items-center justify-between px-6 py-4">
        <h2 className="text-lg font-semibold text-mf-text-primary">Review Changes</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close review panel"
          className="hover:bg-mf-hover"
        >
          ✕
        </Button>
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
