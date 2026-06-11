/**
 * FilesTabStrip — renders the file-tab row inside the Files surface header.
 *
 * Tab visuals from prototype/04-engine.jsx:
 *  - preview tabs have italic titles (prototype `fontStyle: t.preview ? 'italic' : 'normal'`)
 *  - the active tab has a highlighted background
 *  - each tab has a close (×) button
 *  - drag handle stub on each tab (Phase 8 wires real drag)
 *
 * Reuses the SurfaceTabStrip shell conventions (height, border, action-btn class)
 * but adds per-tab rendering where the stub had an empty flex row.
 *
 * data-testid:
 *   files-tab-strip   — strip root
 *   files-tab-<id>    — each tab (stable id, never index)
 *   files-tab-close-<id> — close button
 */
import { FileText, GripHorizontal, GripVertical, LayoutPanelLeft, LayoutPanelTop, Plus, X } from 'lucide-react';
import { useSurfaceDragStore } from './use-surface-drag';
import { useTabsStore } from '@/store/tabs';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';
import type { EditorTabModel } from '@/store/tabs';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

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
        'group flex h-full flex-shrink-0 cursor-pointer select-none items-center gap-1 px-2',
        'rounded-[6px] transition-colors duration-[120ms]',
        isActive ? 'bg-mf-tab-active text-foreground' : 'text-mf-text-3 hover:bg-accent hover:text-foreground',
        'max-w-[160px] min-w-0',
      ].join(' ')}
      onClick={() => onActivate(tab.id)}
      onDoubleClick={() => onPromote(tab.id)}
    >
      {/* Drag handle — begins a Files-tab drag onto the Run region. */}
      <span
        data-testid={`files-tab-drag-${tab.id}`}
        className="flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginTabDrag(tab.id, { clientX: e.clientX, clientY: e.clientY });
        }}
      >
        <GripVertical size={10} className="text-mf-text-4" />
      </span>

      {/* File icon */}
      <FileText size={11} className="flex-shrink-0 text-mf-surface-files" />

      {/* Title — italic when preview */}
      <span
        className={[
          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-none',
          tab.mode === 'preview' ? 'italic' : '',
        ].join(' ')}
      >
        {tab.title}
      </span>

      {/* Close button */}
      <button
        data-testid={`files-tab-close-${tab.id}`}
        type="button"
        title={`Close ${tab.title}`}
        className={`ml-0.5 inline-flex h-[14px] w-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-none bg-transparent opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 ${isActive ? 'opacity-60' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
      >
        <X size={9} />
      </button>
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
  const beginSurfaceDrag = useSurfaceDragStore((s) => s.beginSurfaceDrag);

  return (
    <div
      data-testid="files-tab-strip"
      className="flex h-[34px] flex-shrink-0 items-center bg-mf-tab-bar [border-bottom:0.5px_solid_var(--border)]"
    >
      {/* Drag grip — repositions the whole Files surface. */}
      <div
        data-testid="files-surface-drag"
        className="grid h-full w-5 flex-shrink-0 cursor-grab place-items-center pl-1"
        onPointerDown={(e) => beginSurfaceDrag('files', { clientX: e.clientX, clientY: e.clientY })}
      >
        <GripHorizontal size={13} className="text-mf-text-4" />
      </div>

      {/* Surface icon */}
      <div className="flex-shrink-0 px-1">
        <FileText size={11} className="text-mf-surface-files" />
      </div>

      {/* Tab pills */}
      <div className="flex h-full min-w-0 flex-auto items-center gap-0.5 overflow-x-auto pr-0.5 [scrollbar-width:none]">
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

      {/* + add button (stub) */}
      <button
        data-testid="files-tab-strip-add"
        type="button"
        title="Open file / View changes"
        className={`${ACTION_BTN} ml-0.5`}
      >
        <Plus size={11} className="text-mf-text-3" />
      </button>

      <div className="flex-1" />

      {/* Right action cluster */}
      <div className="flex flex-shrink-0 items-center gap-px px-1.5">
        {splitAvailable && (
          <>
            <button
              data-testid="files-tab-strip-split-right"
              type="button"
              title="Split right"
              onClick={() => splitSurface('v')}
              className={ACTION_BTN}
            >
              <LayoutPanelLeft size={13} className="text-mf-text-3" />
            </button>
            <button
              data-testid="files-tab-strip-split-down"
              type="button"
              title="Split down"
              onClick={() => splitSurface('h')}
              className={ACTION_BTN}
            >
              <LayoutPanelTop size={13} className="text-mf-text-3" />
            </button>
          </>
        )}
        <button
          data-testid="files-tab-strip-close"
          type="button"
          title="Close Files"
          onClick={() => toggleSurface('files')}
          className={ACTION_BTN}
        >
          <X size={12} className="text-mf-text-3" />
        </button>
      </div>
    </div>
  );
}
