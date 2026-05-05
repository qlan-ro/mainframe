export const TAG_PALETTE = Object.freeze([
  'blue',
  'red',
  'purple',
  'violet',
  'amber',
  'teal',
  'cyan',
  'green',
  'pink',
  'orange',
] as const);
export type TagColor = (typeof TAG_PALETTE)[number];

/** Used for synthetic chips in the filter bar — outside the user palette so it signals "system" visually. */
export const SYNTHETIC_TAG_COLOR: TagColor | 'gray' = 'gray';
export const RESERVED_TAG_PREFIX = 'has-';

export const SYNTHETIC_TAGS = Object.freeze(['has-pr', 'has-worktree'] as const);
export type SyntheticTag = (typeof SYNTHETIC_TAGS)[number];

export interface Tag {
  name: string;
  color: TagColor;
  createdAt: string;
}
