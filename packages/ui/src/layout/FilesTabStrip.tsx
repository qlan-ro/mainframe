/**
 * FilesTabStrip — renders the file-tab row inside the Files surface header.
 * Mirrors RunTabStrip conventions (grip/surface-icon/tab-pill/right-cluster).
 *
 * Tab visuals from prototype/04-engine.jsx:
 *  - preview tabs have italic titles
 *  - the active tab has a highlighted background
 *  - each tab has a close (×) button
 *  - drag handle stub on each tab (Phase 8 wires real drag)
 *
 * data-testid:
 *   files-tab-strip      — strip root
 *   files-surface-drag   — surface drag grip
 *   files-tab-<id>       — each tab (stable id, never index); whole pill drags
 *   files-tab-close-<id> — close button
 *   files-tab-strip-add  — the + trigger (opens file-picker)
 *   files-tab-strip-split-right / -split-down — split actions
 *   files-tab-strip-close — close the Files surface
 */
import { Code2, FileText, GitCompare, GripVertical, LayoutPanelLeft, LayoutPanelTop, Plus, X } from 'lucide-react';
import { EditorGlyph } from '@/layout/surface-icons';
import { useSurfaceDragStore } from './use-surface-drag';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useTabsStore } from '@/store/tabs';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { Hint } from '@/components/ui/hint';
import type { EditorTabModel } from '@/store/tabs';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

// ── Per-kind tab icon ────────────────────────────────────────────────────────

function tabGlyph(tab: EditorTabModel, isActive: boolean) {
  // Inactive → muted (text3); active → per-type accent color.
  const baseColor = isActive ? '' : 'text-mf-text-3';
  const cls = `flex-shrink-0 ${baseColor}`;

  if (tab.kind === 'diff') {
    const color = isActive ? 'text-mf-accent-amber' : 'text-mf-text-3';
    return <GitCompare size={12} className={`flex-shrink-0 ${color}`} />;
  }
  if (tab.kind === 'code') {
    return <Code2 size={12} className={cls} />;
  }
  // viewer / unknown
  return <FileText size={12} className={cls} />;
}

// ── Single tab pill ──────────────────────────────────────────────────────────

interface TabPillProps {
  tab: EditorTabModel;
  isActive: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onPromote: (id: string) => void;
}

function TabPill({ tab, isActive, onActivate, onClose, onPromote }: TabPillProps) {
  const beginTabDrag = useSurfaceDragStore((s) => s.beginTabDrag);
  return (
    <div
      data-testid={`files-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      className={[
        'group flex h-[26px] min-w-0 max-w-[160px] flex-shrink-0 cursor-pointer select-none items-center gap-[6px] pl-[9px] pr-[6px]',
        'rounded-[7px] tracking-tight transition-colors duration-[120ms]',
        isActive
          ? 'bg-mf-chip font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
      onClick={() => onActivate(tab.id)}
      onDoubleClick={() => onPromote(tab.id)}
      onPointerDown={(e) => {
        // The whole pill is the drag handle (no visible grip — matches the design
        // SurfaceTabStrip). A click with <4px movement is treated as a click by
        // the drag store's threshold, so activation still works.
        if (e.button !== 0) return;
        beginTabDrag(tab.id, { clientX: e.clientX, clientY: e.clientY });
      }}
    >
      {/* Per-kind icon */}
      {tabGlyph(tab, isActive)}

      {/* Title — italic when preview; full path on hover */}
      <TruncatedWithTooltip
        text={tab.title}
        tooltip={tab.path ?? tab.title}
        className={['min-w-0 flex-1 text-caption leading-none', tab.mode === 'preview' ? 'italic' : ''].join(' ')}
        contentClassName="font-mono break-all"
      />

      {/* Close button */}
      <Hint label={`Close ${tab.title}`}>
        <button
          data-testid={`files-tab-close-${tab.id}`}
          type="button"
          className={`inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] opacity-0 transition-opacity duration-[120ms] hover:bg-accent group-hover:opacity-100 ${isActive ? 'opacity-60' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
        >
          <X size={12} />
        </button>
      </Hint>
    </div>
  );
}

// ── Strip ────────────────────────────────────────────────────────────────────

export function FilesTabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activateTab = useTabsStore((s) => s.activateTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const promoteTab = useTabsStore((s) => s.promoteTab);

  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const filesIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'files'));
  const beginSurfaceDrag = useSurfaceDragStore((s) => s.beginSurfaceDrag);

  return (
    <div
      data-testid="files-tab-strip"
      className="flex h-[36px] flex-shrink-0 items-center [border-bottom:0.5px_solid_var(--border)]"
    >
      {/* Drag grip — repositions the whole Files surface. */}
      <div
        data-testid="files-surface-drag"
        className="grid h-full w-[20px] flex-shrink-0 cursor-grab place-items-center pl-[4px]"
        onPointerDown={(e) => beginSurfaceDrag('files', { clientX: e.clientX, clientY: e.clientY })}
      >
        <GripVertical size={13} className="text-mf-text-4" />
      </div>

      {/* Surface icon */}
      <div className="flex-shrink-0 px-[4px]">
        <EditorGlyph size={12} className="text-mf-surface-files" />
      </div>

      {/* Tab pills */}
      <div className="flex h-full min-w-0 flex-initial items-center gap-[2px] overflow-x-auto pr-[2px] [scrollbar-width:none]">
        {tabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onActivate={activateTab}
            onClose={closeTab}
            onPromote={promoteTab}
          />
        ))}
      </div>

      {/* + add button — opens the file-open command palette */}
      <Hint label="Open file">
        <button
          data-testid="files-tab-strip-add"
          type="button"
          onClick={() => emitSurfaceIntent({ type: 'open-file-picker' })}
          className={`${ACTION_BTN} ml-0.5`}
        >
          <Plus size={12} className="text-mf-text-3" />
        </button>
      </Hint>

      <div className="flex-1" />

      {/* Right action cluster */}
      <div className="flex flex-shrink-0 items-center gap-px pl-[2px] pr-[6px]">
        {splitAvailable && (
          <>
            <Hint label="Split right">
              <button
                data-testid="files-tab-strip-split-right"
                type="button"
                onClick={() => splitSurface('v')}
                className={ACTION_BTN}
              >
                <LayoutPanelLeft size={13} className="text-mf-text-3" />
              </button>
            </Hint>
            <Hint label="Split down">
              <button
                data-testid="files-tab-strip-split-down"
                type="button"
                onClick={() => splitSurface('h')}
                className={ACTION_BTN}
              >
                <LayoutPanelTop size={13} className="text-mf-text-3" />
              </button>
            </Hint>
          </>
        )}
        <Hint label="Close Files">
          <button
            data-testid="files-tab-strip-close"
            type="button"
            disabled={filesIsFloor}
            onClick={() => toggleSurface('files')}
            className={`${ACTION_BTN} ${filesIsFloor ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <X size={12} className="text-mf-text-3" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
