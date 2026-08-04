import * as React from 'react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { cn } from '@v2/lib/utils';

export const SIDEBAR_WIDTH = '16rem';
export const SIDEBAR_WIDTH_ICON = '3rem';
export const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

/** Below the floor the two-line rows truncate to nothing; above the ceiling the panel stops being chrome. */
export const SIDEBAR_MIN_WIDTH = 208;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export type SidebarState = 'expanded' | 'collapsed';

interface SidebarContextValue {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  /** Null until dragged — the panel sits at the `SIDEBAR_WIDTH` default. */
  width: number | null;
  setWidth: (width: number) => void;
  /** True mid-drag, so the panel can drop its width transition and track the pointer. */
  resizing: boolean;
  setResizing: (resizing: boolean) => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

interface SidebarProviderProps extends React.ComponentProps<'div'> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Seed for a persisted drag width; null keeps the `SIDEBAR_WIDTH` default. */
  defaultWidth?: number | null;
  onWidthChange?: (width: number) => void;
}

/**
 * Owns open/collapsed state and the ⌘B shortcut.
 *
 * Two deviations from upstream, both because this is a desktop app: there is no
 * mobile Sheet branch, and state is not persisted to a `sidebar_state` cookie —
 * pass `open`/`onOpenChange` (and `defaultWidth`/`onWidthChange` for the drag
 * width) to drive it from a store instead.
 */
export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  defaultWidth = null,
  onWidthChange,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const [width, setWidthState] = React.useState<number | null>(
    defaultWidth == null ? null : clampSidebarWidth(defaultWidth),
  );
  const [resizing, setResizing] = React.useState(false);
  const setWidth = React.useCallback(
    (value: number) => {
      const clamped = clampSidebarWidth(value);
      setWidthState(clamped);
      onWidthChange?.(clamped);
    },
    [onWidthChange],
  );

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (onOpenChange) onOpenChange(value);
      else setInternalOpen(value);
    },
    [onOpenChange],
  );

  const toggleSidebar = React.useCallback(() => setOpen(!open), [open, setOpen]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== SIDEBAR_KEYBOARD_SHORTCUT) return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen,
      toggleSidebar,
      width,
      setWidth,
      resizing,
      setResizing,
    }),
    [open, setOpen, toggleSidebar, width, setWidth, resizing],
  );

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': width == null ? SIDEBAR_WIDTH : `${width}px`,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn('group/sidebar-wrapper flex h-full w-full has-data-[variant=inset]:bg-sidebar', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}
