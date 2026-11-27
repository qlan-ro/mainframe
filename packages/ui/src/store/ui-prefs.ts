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

/** Every section the session panel can show, in panel order. */
export const SESSION_PANEL_SECTION_KEYS = [
  'prs',
  'plan',
  'activity',
  'launch',
  'memory',
  'mentions',
  'skills',
  'attachments',
  'tasks',
] as const;

export type SessionPanelSectionKey = (typeof SESSION_PANEL_SECTION_KEYS)[number];

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

/** Whether a turn's work row folds once the turn has ended, or stays open. */
export type FinishedWork = 'fold' | 'open';
/** Where a URL in a reply opens: the workspace browser, or the system's own. */
export type LinkTarget = 'workspace' | 'browser';

/** What Enter does while a turn runs; ⌥↵ does the other (C9). */
export type EnterWhileRunning = 'queue' | 'steer';

/** The un-dragged cap of the transcript column and the composer: 740px of content plus 2 × 20px padding. */
export const TRANSCRIPT_DEFAULT_WIDTH = 780;
/** The default before v9; a persisted copy of it migrates to the new default. */
const TRANSCRIPT_LEGACY_DEFAULT_WIDTH = 680;
const TRANSCRIPT_MIN_WIDTH = 480;
const TRANSCRIPT_MAX_WIDTH = 1600;

export function clampTranscriptWidth(width: number): number {
  if (!Number.isFinite(width)) return TRANSCRIPT_DEFAULT_WIDTH;
  return Math.round(Math.min(TRANSCRIPT_MAX_WIDTH, Math.max(TRANSCRIPT_MIN_WIDTH, width)));
}

/** Whole turns loaded when a chat opens and for each older page. */
export const HISTORY_TURNS_DEFAULT = 10;
export const HISTORY_TURNS_MIN = 2;
export const HISTORY_TURNS_MAX = 50;

export function clampHistoryTurns(turns: unknown): number {
  if (typeof turns !== 'number' || !Number.isFinite(turns)) return HISTORY_TURNS_DEFAULT;
  return Math.round(Math.min(HISTORY_TURNS_MAX, Math.max(HISTORY_TURNS_MIN, turns)));
}

interface UiPrefsState {
  finishedWork: FinishedWork;
  setFinishedWork: (finishedWork: FinishedWork) => void;
  openLinksIn: LinkTarget;
  setOpenLinksIn: (openLinksIn: LinkTarget) => void;
  enterWhileRunning: EnterWhileRunning;
  setEnterWhileRunning: (mode: EnterWhileRunning) => void;
  /** The composer shows `@` and `/` tokens as atomic chips (a Lexical field). Off by default while it is tested. */
  chipComposer: boolean;
  setChipComposer: (on: boolean) => void;
  /** Turns the transcript loads at a time: the first window and every older page.
   *  It only changes what is requested, so the next open or page picks it up. */
  historyTurns: number;
  setHistoryTurns: (turns: number) => void;
  /** The composer's activity strip shows only its first row (K5). */
  activityStripCollapsed: boolean;
  setActivityStripCollapsed: (collapsed: boolean) => void;
  /** The transcript column's cap, dragged from its edge grips. A narrower
   *  chat column still squeezes it — this is a max, not a fixed width. */
  transcriptWidth: number;
  setTranscriptWidth: (width: number) => void;
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
  /** Sections the viewer turned off in the panel's Sections menu. */
  sessionPanelHiddenSections: readonly SessionPanelSectionKey[];
  /** Committed sizes for opt-in resizable dialogs. Absent keys read as that
   *  dialog's declared default; see dialogSizeFor. */
  dialogSizes: DialogSizes;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarView: (view: SidebarView) => void;
  dismissTuningChangeWarning: () => void;
  toggleSessionPanel: () => void;
  setSessionPanelOpen: (open: boolean) => void;
  toggleSessionPanelSection: (id: SessionPanelOpenSectionId) => void;
  setSessionPanelSectionShown: (key: SessionPanelSectionKey, shown: boolean) => void;
  /** Overwrites the committed size for one dialog key. Callers clamp before
   *  committing — the store doesn't know a dialog's measured minimum. */
  setDialogSize: (key: string, size: DialogSize) => void;
}

/** The persisted subset. */
function partializeUiPrefs(s: UiPrefsState) {
  return {
    finishedWork: s.finishedWork,
    openLinksIn: s.openLinksIn,
    enterWhileRunning: s.enterWhileRunning,
    chipComposer: s.chipComposer,
    historyTurns: s.historyTurns,
    activityStripCollapsed: s.activityStripCollapsed,
    transcriptWidth: s.transcriptWidth,
    sidebarVisible: s.sidebarVisible,
    sidebarWidth: s.sidebarWidth,
    sidebarView: s.sidebarView,
    dontWarnOnTuningChange: s.dontWarnOnTuningChange,
    sessionPanelOpen: s.sessionPanelOpen,
    sessionPanelSections: s.sessionPanelSections,
    sessionPanelHiddenSections: s.sessionPanelHiddenSections,
    dialogSizes: s.dialogSizes,
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

function sanitizeHiddenSections(value: unknown): SessionPanelSectionKey[] {
  return Array.isArray(value) ? SESSION_PANEL_SECTION_KEYS.filter((key) => value.includes(key)) : [];
}

/**
 * The retired cards-or-rows choice carries over until this one is made: Verbose
 * kept everything in sight. Main wrote `verbose` for the default too, so a
 * viewer who never chose it also starts on Keep open; nothing stored is Fold.
 */
function sanitizeFinishedWork({ finishedWork, transcriptMode }: Record<string, unknown>): FinishedWork {
  if (finishedWork === 'open' || finishedWork === 'fold') return finishedWork;
  return transcriptMode === 'verbose' ? 'open' : 'fold';
}

function sanitizeTranscriptPreference(persisted: unknown): Partial<PersistedUiPrefs> {
  const stored = persisted !== null && typeof persisted === 'object' ? (persisted as Record<string, unknown>) : {};
  const { transcriptMode: _retired, ...state } = stored;
  return {
    ...state,
    finishedWork: sanitizeFinishedWork(stored),
    openLinksIn: state.openLinksIn === 'browser' ? 'browser' : 'workspace',
    enterWhileRunning: state.enterWhileRunning === 'steer' ? 'steer' : 'queue',
    chipComposer: state.chipComposer === true,
    historyTurns: clampHistoryTurns(state.historyTurns),
    activityStripCollapsed: state.activityStripCollapsed === true,
    transcriptWidth:
      typeof state.transcriptWidth === 'number'
        ? clampTranscriptWidth(state.transcriptWidth)
        : TRANSCRIPT_DEFAULT_WIDTH,
    sidebarView: sanitizeBootSidebarView(state.sidebarView),
    sessionPanelHiddenSections: sanitizeHiddenSections(state.sessionPanelHiddenSections),
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

/**
 * v9: the column default grew to the composer's 740px of content, and the
 * provider-switch confirmation (with its "Don't ask again") is gone.
 */
function migrateToV9(next: Record<string, unknown>): void {
  if (next.transcriptWidth === TRANSCRIPT_LEGACY_DEFAULT_WIDTH) next.transcriptWidth = TRANSCRIPT_DEFAULT_WIDTH;
  delete next.dontConfirmProviderSwitch;
}

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      finishedWork: 'fold',
      setFinishedWork: (finishedWork) => set({ finishedWork }),
      openLinksIn: 'workspace',
      setOpenLinksIn: (openLinksIn) => set({ openLinksIn }),
      enterWhileRunning: 'queue',
      setEnterWhileRunning: (enterWhileRunning) => set({ enterWhileRunning }),
      chipComposer: false,
      setChipComposer: (chipComposer) => set({ chipComposer }),
      historyTurns: HISTORY_TURNS_DEFAULT,
      setHistoryTurns: (turns) => set({ historyTurns: clampHistoryTurns(turns) }),
      activityStripCollapsed: false,
      setActivityStripCollapsed: (activityStripCollapsed) => set({ activityStripCollapsed }),
      transcriptWidth: TRANSCRIPT_DEFAULT_WIDTH,
      setTranscriptWidth: (width) => set({ transcriptWidth: clampTranscriptWidth(width) }),
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      sidebarView: 'chats',
      dontWarnOnTuningChange: false,
      sessionPanelOpen: true,
      sessionPanelSections: {},
      sessionPanelHiddenSections: [],
      dialogSizes: {},
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
      setSessionPanelSectionShown: (key, shown) =>
        set((s) => {
          const others = s.sessionPanelHiddenSections.filter((hidden) => hidden !== key);
          return { sessionPanelHiddenSections: shown ? others : [...others, key] };
        }),
      setDialogSize: (key, size) => set((s) => ({ dialogSizes: { ...s.dialogSizes, [key]: size } })),
    }),
    {
      name: 'mf:ui-prefs',
      version: 9,
      partialize: partializeUiPrefs,
      merge: (persisted, current) => ({ ...current, ...sanitizeTranscriptPreference(persisted) }),
      migrate: (persisted, version): PersistedUiPrefs => {
        if (version >= 9 || persisted === null || typeof persisted !== 'object') {
          return sanitizeTranscriptPreference(persisted) as PersistedUiPrefs;
        }
        const next = { ...(persisted as Record<string, unknown>) };
        migrateToV9(next);
        if (version === 8) return sanitizeTranscriptPreference(next) as PersistedUiPrefs;
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
