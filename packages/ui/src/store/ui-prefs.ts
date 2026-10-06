/**
 * ui-prefs — the single persisted store for global UI chrome.
 *
 * Owns sidebar visibility, the committed sidebar width, which list the
 * sidebar shows (`sidebarView`, chosen on the nav rail), the session panel's
 * open bit and per-section open state, and committed sizes for opt-in
 * resizable dialogs. Persisted to localStorage under
 * `mf:ui-prefs` via zustand's persist middleware (mirrors store/tutorial.ts).
 * Per-session surface layout is NOT here — it stays in-memory in
 * store/layout.ts (live PTY/preview refs make it unsafe to persist). The
 * workspace Files sidebar's open state is scoped per project/worktree, so it
 * lives in its own store — store/workspace-files-panel — not here.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { clampSidebarWidth } from '@/components/ui/sidebar';

/** Matches the sidebar primitive's `SIDEBAR_WIDTH` (260px) — the un-dragged default. */
export const SIDEBAR_DEFAULT_WIDTH = 260;
/** The default before v8; a persisted copy of it migrates to the new default. */
const SIDEBAR_LEGACY_DEFAULT_WIDTH = 256;

/**
 * Which list the sidebar hosts; the nav rail selects, the sidebar renders.
 * 'settings' is reachable (⌘, the rail's Settings button, every
 * `useSettingsStore`-adjacent open path) but never restored on boot — see
 * `sanitizeBootSidebarView`.
 */
export type SidebarView = 'chats' | 'tasks' | 'automations' | 'advisor' | 'settings';

/** The pre-v8 stacked panels — kept only so the v8 migration can name them. */
type LegacySessionPanelId = 'session' | 'activity' | 'launch' | 'tasks';

/** The session card's collapsible sections (Summary is never collapsible). */
export type SessionPanelSectionId = 'summary' | 'plan' | 'context';

export type SessionPanelOpenSectionId = Exclude<SessionPanelSectionId, 'summary'>;

/** Context is the reference material you scan, so it starts open. */
const SESSION_PANEL_SECTION_DEFAULTS: Record<SessionPanelOpenSectionId, boolean> = {
  plan: false,
  context: true,
};

export type SessionPanelSections = Partial<Record<SessionPanelOpenSectionId, boolean>>;

/** Selector helper: a section with no recorded state falls back to its default. */
export function isSessionPanelSectionOpen(sections: SessionPanelSections, id: SessionPanelOpenSectionId): boolean {
  return sections[id] ?? SESSION_PANEL_SECTION_DEFAULTS[id];
}

/** A committed dialog size, in CSS pixels. */
export interface DialogSize {
  width: number;
  height: number;
}

/** Keyed by the opt-in dialog's stable `resizeKey` (e.g. `'settings'`). */
export type DialogSizes = Record<string, DialogSize>;

/** Selector helper: a dialog with no recorded size falls back to its declared default. */
export function dialogSizeFor(sizes: DialogSizes, key: string, fallback: DialogSize): DialogSize {
  return sizes[key] ?? fallback;
}

const SIDE_CHAT_DEFAULT_FRAC = 0.4;

export type TranscriptMode = 'verbose' | 'compact';

interface UiPrefsState {
  transcriptMode: TranscriptMode;
  setTranscriptMode: (mode: TranscriptMode) => void;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarView: SidebarView;
  /** Once true, the mid-session model/effort/feature change warning is suppressed for good. */
  dontWarnOnTuningChange: boolean;
  /** Whether the session panel is open. ONE bit for the whole panel — it is a
   *  single docked column of sections, not a stack of cards. This store is the
   *  sole owner so the choice survives a remount and a session switch. */
  sessionPanelOpen: boolean;
  /** Per-section open state inside the session card. Absent keys read as the
   *  section's default; see isSessionPanelSectionOpen. */
  sessionPanelSections: SessionPanelSections;
  /** Committed sizes for opt-in resizable dialogs. Absent keys read as that
   *  dialog's declared default; see dialogSizeFor. */
  dialogSizes: DialogSizes;
  /** The side chat's share of its parent's row while docked beside it. */
  sideChatFrac: number;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarView: (view: SidebarView) => void;
  dismissTuningChangeWarning: () => void;
  toggleSessionPanel: () => void;
  setSessionPanelOpen: (open: boolean) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
  /** Overwrites the committed size for one dialog key. Callers clamp before
   *  committing — the store doesn't know a dialog's measured minimum. */
  setDialogSize: (key: string, size: DialogSize) => void;
  setSideChatFrac: (frac: number) => void;
}

/** The persisted subset. */
function partializeUiPrefs(s: UiPrefsState) {
  return {
    transcriptMode: s.transcriptMode,
    sidebarVisible: s.sidebarVisible,
    sidebarWidth: s.sidebarWidth,
    sidebarView: s.sidebarView,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
    sessionPanelOpen: s.sessionPanelOpen,
    sessionPanelSections: s.sessionPanelSections,
    dialogSizes: s.dialogSizes,
    sideChatFrac: s.sideChatFrac,
  };
}

type PersistedUiPrefs = ReturnType<typeof partializeUiPrefs>;

const SIDEBAR_VIEWS: readonly SidebarView[] = ['chats', 'tasks', 'automations', 'advisor', 'settings'];

function sanitizeSidebarView(value: unknown): SidebarView {
  return SIDEBAR_VIEWS.includes(value as SidebarView) ? (value as SidebarView) : 'chats';
}

/**
 * 'settings' is a view you navigate TO, never one you boot into — applied on
 * every rehydration (not just a version migration), same as the transcript
 * sanitizer below, so no version bump is needed for it to take effect.
 */
function sanitizeBootSidebarView(value: unknown): SidebarView {
  const view = sanitizeSidebarView(value);
  return view === 'settings' ? 'chats' : view;
}

function sanitizeTranscriptPreference(persisted: unknown): Partial<PersistedUiPrefs> {
  const state = persisted !== null && typeof persisted === 'object' ? (persisted as Record<string, unknown>) : {};
  return {
    ...state,
    transcriptMode: state.transcriptMode === 'compact' ? 'compact' : 'verbose',
    sidebarView: sanitizeBootSidebarView(state.sidebarView),
  };
}

/** The pre-v8 per-card defaults — the session card alone opened by default. */
const LEGACY_PANEL_DEFAULTS: Record<LegacySessionPanelId, boolean> = {
  session: true,
  activity: false,
  launch: false,
  tasks: false,
};

/**
 * v8: the four stacked cards became one docked panel, so their four open bits
 * collapse to one — open if ANY card was open (an absent key reads as that
 * card's old default). The legacy 256px default width maps to the new 260;
 * a width the user dragged to is left alone.
 */
function migrateToV8(next: Record<string, unknown>): void {
  const raw = next.sessionPanelOpen;
  if (typeof raw !== 'boolean') {
    const legacy = (raw ?? {}) as Partial<Record<LegacySessionPanelId, boolean>>;
    next.sessionPanelOpen = (Object.keys(LEGACY_PANEL_DEFAULTS) as LegacySessionPanelId[]).some(
      (id) => legacy[id] ?? LEGACY_PANEL_DEFAULTS[id],
    );
  }
  if (next.sidebarWidth === SIDEBAR_LEGACY_DEFAULT_WIDTH) next.sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
  next.sidebarView = sanitizeSidebarView(next.sidebarView);
}

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      transcriptMode: 'verbose',
      setTranscriptMode: (transcriptMode) => set({ transcriptMode }),
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      sidebarView: 'chats',
      dontWarnOnTuningChange: false,
      sessionPanelOpen: true,
      sessionPanelSections: {},
      dialogSizes: {},
      sideChatFrac: SIDE_CHAT_DEFAULT_FRAC,
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setSidebarView: (sidebarView) => set({ sidebarView }),
      dismissTuningChangeWarning: () => set({ dontWarnOnTuningChange: true }),
      toggleSessionPanel: () => set((s) => ({ sessionPanelOpen: !s.sessionPanelOpen })),
      setSessionPanelOpen: (sessionPanelOpen) => set({ sessionPanelOpen }),
      toggleSessionPanelSection: (id) =>
        set((s) => ({
          sessionPanelSections: {
            ...s.sessionPanelSections,
            [id]: !isSessionPanelSectionOpen(s.sessionPanelSections, id),
          },
        })),
      setDialogSize: (key, size) => set((s) => ({ dialogSizes: { ...s.dialogSizes, [key]: size } })),
      setSideChatFrac: (frac) => set({ sideChatFrac: Math.min(0.85, Math.max(0.15, frac)) }),
    }),
    {
      name: 'mf:ui-prefs',
      version: 8,
      partialize: partializeUiPrefs,
      merge: (persisted, current) => ({ ...current, ...sanitizeTranscriptPreference(persisted) }),
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 8 || persisted === null || typeof persisted !== 'object') {
          return sanitizeTranscriptPreference(persisted) as PersistedUiPrefs;
        }
        const next = { ...(persisted as Record<string, unknown>) };
        if (version >= 6) {
          migrateToV8(next);
          return sanitizeTranscriptPreference(next) as PersistedUiPrefs;
        }
        if (version < 2) {
          // v2 retired the bottom Context/Skills/Agents panel; its two keys are
          // dropped so a stale tab/height can never rehydrate into the new panel.
          delete next.bottomPanelTab;
          delete next.bottomPanelHeight;
        }
        if (version < 4) {
          // v3 retired the right InspectorPane; v4 retired its short-lived docked
          // successor — the Files tree became a transient floating panel, so
          // neither flag persisted at the time. (2026-08-15: it's a docked
          // sidebar again, but its open state lives in its own scoped store —
          // store/workspace-files-panel, keyed per project/worktree — not here.)
          delete next.inspectorVisible;
          delete next.workspaceFilesCollapsed;
        }
        if (version < 5) {
          // v5 split Activity/Launch out of the session card into stacked panels:
          // their old section bits become panel bits, and the whole-card collapse
          // becomes the session panel's own open bit.
          const sections = { ...(next.sessionPanelSections as Record<string, unknown> | undefined) };
          next.sessionPanelOpen = {
            ...(typeof sections.activity === 'boolean' ? { activity: sections.activity } : {}),
            ...(typeof sections.launch === 'boolean' ? { launch: sections.launch } : {}),
            ...(next.sessionPanelCollapsed === true ? { session: false } : {}),
          };
          delete sections.activity;
          delete sections.launch;
          next.sessionPanelSections = sections;
          delete next.sessionPanelCollapsed;
        }
        // v6 replaced the Projects section with the scope-selector dropdown: no
        // collapsible sidebar sections and no right-click affordance remain.
        delete next.collapsedSidebarSections;
        delete next.rightClickHintDismissed;
        migrateToV8(next);
        return sanitizeTranscriptPreference(next) as PersistedUiPrefs;
      },
    },
  ),
);
