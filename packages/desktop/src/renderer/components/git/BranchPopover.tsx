import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Loader2, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BranchList } from './BranchList';
import { BranchSubmenu } from './BranchSubmenu';
import { NewBranchDialog } from './NewBranchDialog';
import { ConflictView } from './ConflictView';
import { useBranchActions } from './useBranchActions';

type View = 'list' | 'submenu' | 'new-branch' | 'conflict' | 'rename';

interface BranchPopoverProps {
  projectId: string;
  onBranchChanged: () => void;
  onClose: () => void;
}

export function BranchPopover({ projectId, onBranchChanged, onClose }: BranchPopoverProps): React.ReactElement {
  const actions = useBranchActions(projectId, onBranchChanged, onClose);
  const { branches, conflictFiles, busy, busyAction } = actions;

  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedIsRemote, setSelectedIsRemote] = useState(false);
  const [newBranchFrom, setNewBranchFrom] = useState<string | undefined>();
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Switch to conflict view when conflicts detected
  useEffect(() => {
    if (conflictFiles.length > 0) setView('conflict');
  }, [conflictFiles]);

  useEffect(() => {
    if (view === 'list') searchRef.current?.focus();
  }, [view]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSelectBranch = useCallback(
    (branch: string, _isCurrent: boolean, isRemote: boolean) => {
      if (view === 'submenu' && selectedBranch === branch) {
        setSelectedBranch(null);
        setView('list');
      } else {
        setSelectedBranch(branch);
        setSelectedIsRemote(isRemote);
        setView('submenu');
      }
    },
    [view, selectedBranch],
  );

  const handleNewBranchFrom = useCallback((branch: string) => {
    setNewBranchFrom(branch);
    setView('new-branch');
  }, []);

  const handleRenameStart = useCallback((branch: string) => {
    setRenameTarget(branch);
    setRenameValue(branch);
    setView('rename');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    await actions.handleRename(renameTarget, renameValue.trim());
    setView('list');
  }, [renameTarget, renameValue, actions]);

  const handleAbortAndReset = useCallback(async () => {
    await actions.handleAbort();
    setView('list');
  }, [actions]);

  const handleCreateAndReset = useCallback(
    async (name: string, startPoint: string) => {
      await actions.handleCreateBranch(name, startPoint);
      setView('list');
    },
    [actions],
  );

  const handleGlobalPush = useCallback(async () => {
    if (!branches) return;
    await actions.handlePush(branches.current);
  }, [branches, actions]);

  if (!branches) {
    return (
      <div ref={popoverRef} className="bg-mf-app-bg border border-mf-border rounded-lg shadow-xl p-4">
        <Loader2 size={16} className="animate-spin text-mf-text-secondary mx-auto" />
      </div>
    );
  }

  const showList = view === 'list' || view === 'submenu';

  return (
    <div ref={popoverRef} className="flex items-start gap-1">
      {/* Main panel */}
      <div className="bg-mf-app-bg border border-mf-border rounded-lg shadow-xl min-w-[300px] max-w-[360px]">
        {view === 'conflict' && (
          <ConflictView conflictFiles={conflictFiles} onAbort={handleAbortAndReset} aborting={busy} />
        )}

        {view === 'rename' && renameTarget && (
          <RenameView
            value={renameValue}
            onChange={setRenameValue}
            onSubmit={handleRenameSubmit}
            onBack={() => setView('list')}
            busy={busy}
          />
        )}

        {view === 'new-branch' && (
          <NewBranchDialog
            localBranches={branches.local.map((b) => b.name)}
            currentBranch={branches.current}
            startFrom={newBranchFrom}
            onBack={() => setView('list')}
            onCreate={handleCreateAndReset}
          />
        )}

        {showList && (
          <>
            {/* Search + actions */}
            <div className="flex items-center gap-1.5 p-2 border-b border-mf-border">
              <div className="flex-1 flex items-center gap-1 px-2 py-1 rounded border border-mf-border bg-mf-app-bg">
                <Search size={12} className="text-mf-text-secondary shrink-0" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search branches..."
                  className="flex-1 bg-transparent text-xs text-mf-text-primary placeholder:text-mf-text-secondary focus:outline-none"
                />
              </div>
              <IconButton
                icon={<Download size={12} className={busyAction === 'fetch' ? 'animate-spin' : ''} />}
                title="Fetch"
                onClick={actions.handleFetch}
                disabled={busy}
              />
              <IconButton icon={<Upload size={12} />} title="Push" onClick={handleGlobalPush} disabled={busy} />
            </div>

            {/* Quick actions */}
            <div className="border-b border-mf-border">
              <button
                onClick={() => {
                  setNewBranchFrom(undefined);
                  setView('new-branch');
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-mf-text-primary hover:bg-mf-hover"
              >
                <Plus size={12} />
                <span>New Branch...</span>
              </button>
              <button
                onClick={actions.handleUpdateAll}
                disabled={busy}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-mf-text-primary hover:bg-mf-hover',
                  busy && 'opacity-40 cursor-not-allowed',
                )}
              >
                <RefreshCw size={12} className={busyAction === 'updateAll' ? 'animate-spin' : ''} />
                <span>Update All</span>
              </button>
            </div>

            {/* Branch list */}
            <BranchList
              local={branches.local}
              remote={branches.remote}
              currentBranch={branches.current}
              search={search}
              onSelectBranch={handleSelectBranch}
            />
          </>
        )}
      </div>

      {/* Flyout submenu — side by side */}
      {view === 'submenu' && selectedBranch && (
        <div className="bg-mf-app-bg border border-mf-border rounded-lg shadow-xl">
          <BranchSubmenu
            branch={selectedBranch}
            isCurrent={selectedBranch === branches.current}
            isRemote={selectedIsRemote}
            onClose={() => setView('list')}
            onCheckout={actions.handleCheckout}
            onPull={actions.handlePull}
            onPush={actions.handlePush}
            onMerge={actions.handleMerge}
            onRebase={actions.handleRebase}
            onRename={handleRenameStart}
            onDelete={actions.handleDelete}
            onNewBranchFrom={handleNewBranchFrom}
            busy={busy}
          />
        </div>
      )}
    </div>
  );
}

function IconButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 rounded hover:bg-mf-hover text-mf-text-secondary',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {icon}
    </button>
  );
}

function RenameView({
  value,
  onChange,
  onSubmit,
  onBack,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  busy: boolean;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <button onClick={onBack} className="p-0.5 hover:bg-mf-hover rounded text-mf-text-secondary">
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-mf-text-primary">Rename Branch</span>
      </div>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        className="w-full px-2 py-1 text-xs rounded border border-mf-border bg-mf-app-bg text-mf-text-primary focus:outline-none focus:ring-1 focus:ring-mf-accent"
        disabled={busy}
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onBack}
          className="px-3 py-1 text-xs rounded border border-mf-border text-mf-text-secondary hover:bg-mf-hover"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className={cn(
            'px-3 py-1 text-xs rounded text-white bg-mf-accent hover:opacity-80',
            (busy || !value.trim()) && 'opacity-40 cursor-not-allowed',
          )}
        >
          Rename
        </button>
      </div>
    </div>
  );
}
