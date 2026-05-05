import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface ActionBarProps {
  commitMessage: string;
  onCommitMessageChange: (message: string) => void;
  onSuggestMessage: () => void;
  onCommit: () => Promise<void>;
  onOpenPR: () => Promise<void>;
  isLoading: boolean;
}

export const ActionBar: React.FC<ActionBarProps> = ({
  commitMessage,
  onCommitMessageChange,
  onSuggestMessage,
  onCommit,
  onOpenPR,
  isLoading,
}) => {
  const [commitError, setCommitError] = useState<string | null>(null);

  const handleCommit = async () => {
    try {
      setCommitError(null);
      await onCommit();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to commit');
    }
  };

  const handleOpenPR = async () => {
    try {
      setCommitError(null);
      await onOpenPR();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Failed to create PR');
    }
  };

  return (
    <div className="border-t border-mf-border bg-mf-panel-bg p-4">
      <div className="mb-3 flex gap-2">
        <Input
          type="text"
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          disabled={isLoading}
          className="flex-1"
        />
        <Button variant="ghost" size="sm" onClick={onSuggestMessage} disabled={isLoading}>
          AI Suggest
        </Button>
      </div>

      {commitError && (
        <div className="mb-3 rounded bg-mf-chat-error-surface px-3 py-2 text-sm text-mf-chat-error">{commitError}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleOpenPR} disabled={isLoading}>
          {isLoading ? 'Creating PR...' : 'Open PR'}
        </Button>
        <Button
          size="sm"
          className="bg-mf-accent text-white hover:bg-mf-accent/90"
          onClick={handleCommit}
          disabled={isLoading || !commitMessage.trim()}
        >
          {isLoading ? 'Committing...' : 'Commit'}
        </Button>
      </div>
    </div>
  );
};
