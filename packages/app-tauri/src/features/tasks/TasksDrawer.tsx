/**
 * TasksDrawer — resizable bottom drawer in the Inspector pane.
 *
 * Resize handle at the top; height in localStorage ('mf.tasks.drawerHeight').
 * Max-height derived from the drawer's own container ref (ResizeObserver) or
 * a fixed cap — NOT from layout/. Composed into InspectorPane below the body.
 *
 * Header: "Tasks" label with active count + New (+) button + Expand button.
 * Body: TasksDrawerList (owns the single load() effect).
 *
 * data-testid="tasks-drawer".
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { TasksGlyph } from '@/layout/surface-icons';
import { useTodosStore } from './use-todos-store';
import { useTasksModal } from './use-tasks-modal';
import { TasksDrawerList } from './TasksDrawerList';
import { TaskEditModal } from './TaskEditModal';
import { extractAllLabels } from './todos-filters';
import type { Todo } from '@/lib/api/todos';

const STORAGE_KEY = 'mf.tasks.drawerHeight';
const DEFAULT_HEIGHT = 220;
const MIN_HEIGHT = 80;
const FIXED_MAX = 600;

function readSavedHeight(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return Math.max(MIN_HEIGHT, parseInt(v, 10));
  } catch {
    /* expected */
  }
  return DEFAULT_HEIGHT;
}

interface Props {
  port: number;
  projectId: string;
  onStartSession?: (todo: Todo) => void;
}

export function TasksDrawer({ port, projectId, onStartSession }: Props): React.ReactElement {
  const [height, setHeight] = useState(readSavedHeight);
  const [maxHeight, setMaxHeight] = useState(FIXED_MAX);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const openModal = useTasksModal((s) => s.openModal);
  const { todos } = useTodosStore();
  const [createOpen, setCreateOpen] = useState(false);
  const allLabels = extractAllLabels(todos);
  const activeCount = todos.filter((t) => t.status !== 'done').length;

  // Observe container to derive max-height cap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const parentHeight = el.parentElement?.offsetHeight ?? 0;
      setMaxHeight(parentHeight > 160 ? parentHeight - 160 : FIXED_MAX);
    });
    obs.observe(el.parentElement ?? el);
    return () => obs.disconnect();
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const next = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeightRef.current + delta));
      setHeight(next);
    },
    [maxHeight],
  );

  const handleMouseUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    try {
      localStorage.setItem(STORAGE_KEY, String(height));
    } catch {
      /* expected */
    }
  }, [handleMouseMove, height]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [height, handleMouseMove, handleMouseUp],
  );

  return (
    <div
      ref={containerRef}
      data-testid="tasks-drawer"
      className="flex flex-col shrink-0 bg-card"
      style={{ height }}
    >
      {/* Resize handle — hairline inner stripe, hover highlights */}
      <div
        data-testid="tasks-drawer-resize-handle"
        className="group h-[5px] w-full cursor-row-resize shrink-0 flex items-center"
        onMouseDown={handleResizeStart}
        aria-label="Resize tasks drawer"
      >
        <div className="h-px w-full bg-border group-hover:bg-primary transition-colors" />
      </div>

      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 shrink-0 [border-bottom:0.5px_solid_var(--border)]">
        <TasksGlyph size={11} className="text-primary flex-shrink-0" />
        <span className="text-caption font-semibold text-foreground">Tasks</span>
        {activeCount > 0 && (
          <span className="font-mono text-micro text-mf-text-3">
            {activeCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            data-testid="tasks-drawer-new"
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border-none bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="New task"
          >
            <Plus size={11} />
          </button>
          <button
            data-testid="tasks-drawer-expand"
            type="button"
            onClick={openModal}
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border-none bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Open full Tasks view"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
        <TasksDrawerList port={port} projectId={projectId} onStartSession={onStartSession ?? (() => undefined)} />
      </div>

      {/* Create modal */}
      {createOpen && (
        <TaskEditModal
          port={port}
          projectId={projectId}
          todo={null}
          allTodos={todos}
          allLabels={allLabels}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
