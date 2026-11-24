import type { Page } from '../../../packages/e2e/node_modules/@playwright/test/index.mjs';
import type { TauriAppFixture } from '../../../packages/e2e/fixtures/app-tauri.js';

/** [x, y, width, height] inside the window. A function reads it from the page when the state is captured. */
export type Crop = [number, number, number, number];

export interface CaptureState {
  id: string;
  /** Markdown-lite caption (`**bold**`, `` `code` ``). Leave out on a board that is one bare window. */
  caption?: string;
  /** Takes the page from the previous state (same group) to this one. */
  setup?: (ctx: CaptureContext) => Promise<void>;
  /** Default: the whole window. A test id crops to that element. */
  crop?: Crop | string | ((page: Page) => Promise<Crop>);
  /** Padding around a test-id crop, in px. */
  pad?: number;
  /** Default: the frame follows the board's Theme tweak. Pin one to draw it always light or dark. */
  theme?: 'light' | 'dark';
  /** Settle time before the DOM is read, in ms. */
  wait?: number;
}

/** States that share one running app. Each group starts a fresh daemon on an empty data dir. */
export interface CaptureGroup {
  /** The board the states go to. Several groups may feed one board, in order. */
  board: string;
  launch?: {
    recordingKey?: string;
    mockMaxDelayMs?: number;
    suppressTour?: boolean;
    mockFork?: boolean;
    mockSwitch?: boolean;
  };
  viewport?: { width: number; height: number };
  /** Before the app loads: network stubs, localStorage. */
  before?: (page: Page) => Promise<void>;
  /** Projects and sessions the states need. */
  seed?: (ctx: CaptureContext) => Promise<void>;
  states: CaptureState[];
}

export interface CaptureBoard {
  /** File stem in design/canvas/project, e.g. `Shell-Window`. */
  file: string;
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** Frames wrap to the next row past this width, in px. */
  width: number;
  /** One full window and nothing else: no title, caption or margin. */
  bare?: boolean;
}

export interface CaptureArea {
  boards: CaptureBoard[];
  groups: CaptureGroup[];
}

export interface CaptureContext {
  app: TauriAppFixture;
  page: Page;
  /** Scratch values a group's seed leaves for its states. */
  vars: Record<string, string>;
}
