/**
 * Glyphs drawn as the redesign draws them where Lucide's current drawing differs.
 * Same 24-unit grid and API as Lucide's own icons.
 */
import { createLucideIcon } from 'lucide-react';

/** A speech bubble. */
export const ChatIcon = createLucideIcon('chat', [
  ['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', key: 'bubble' }],
]);

/** Two speech bubbles: the side chat. */
export const ChatsIcon = createLucideIcon('chats', [
  ['path', { d: 'M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z', key: 'front' }],
  ['path', { d: 'M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1', key: 'back' }],
]);

/** A bolt: automations. */
export const BoltIcon = createLucideIcon('bolt', [['path', { d: 'M13 2 3 14h9l-1 8 10-12h-9z', key: 'bolt' }]]);

/** Three sliders: the panel's sections. */
export const SlidersIcon = createLucideIcon('sliders', [
  ['path', { d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4', key: 'sliders' }],
]);

/** A route between two stops: a workflow. */
export const RouteIcon = createLucideIcon('route', [
  ['circle', { cx: '6', cy: '19', r: '3', key: 'from' }],
  ['path', { d: 'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15', key: 'way' }],
  ['circle', { cx: '18', cy: '5', r: '3', key: 'to' }],
]);

/** A question in a bubble. */
export const QuestionIcon = createLucideIcon('question', [
  ['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22z', key: 'bubble' }],
  ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01', key: 'mark' }],
]);

/** A four-point star: the agent decides. */
export const SparkIcon = createLucideIcon('spark', [
  ['path', { d: 'm12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', key: 'star' }],
]);

/** A funnel: filter. */
export const FilterIcon = createLucideIcon('filter', [
  ['path', { d: 'M22 3H2l8 9.46V19l4 2v-8.54z', key: 'funnel' }],
]);

/** A keyboard. */
export const KeyboardIcon = createLucideIcon('keyboard', [
  ['rect', { x: '2', y: '5', width: '20', height: '14', rx: '2', key: 'case' }],
  ['path', { d: 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8', key: 'keys' }],
]);

/** A git branch. */
export const BranchIcon = createLucideIcon('branch', [
  ['path', { d: 'M6 3v12', key: 'trunk' }],
  ['circle', { cx: '18', cy: '6', r: '3', key: 'tip' }],
  ['circle', { cx: '6', cy: '18', r: '3', key: 'base' }],
  ['path', { d: 'M18 9a9 9 0 0 1-9 9', key: 'limb' }],
]);

/** A checklist: tasks. */
export const ChecklistIcon = createLucideIcon('checklist', [
  ['path', { d: 'm3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8', key: 'list' }],
]);

/** A pencil: edit. */
export const PencilIcon = createLucideIcon('pencil-tip', [
  [
    'path',
    {
      d: 'M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z',
      key: 'pencil',
    },
  ],
]);

/** A paperclip: attach files. */
export const PaperclipIcon = createLucideIcon('paperclip', [
  [
    'path',
    {
      d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
      key: 'clip',
    },
  ],
]);

/** An arrow to the right: move elsewhere. */
export const MoveIcon = createLucideIcon('move-to', [['path', { d: 'M5 12h14M13 6l6 6-6 6', key: 'arrow' }]]);

/** Start a launch configuration. */
export const PlayIcon = createLucideIcon('play', [['path', { d: 'M6 3l14 9-14 9z', key: 'play' }]]);

/** Stop what runs. */
export const StopIcon = createLucideIcon('stop', [
  ['rect', { x: '5', y: '5', width: '14', height: '14', rx: '2.5', key: 'stop' }],
]);
