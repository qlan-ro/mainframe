/**
 * Lockstep guard for the `worktree.offer.*` events: the golden fixtures under
 * `packages/core-rs/crates/mainframe-types/tests/fixtures/` are the same bytes the Rust round-trip tests in
 * `mainframe-types::events` consume, so a drift on either side fails here.
 * The expected values are typed `DaemonEvent` literals, which makes the TS
 * union itself part of the assertion at compile time.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { DaemonEvent, WorktreeSwitchOffer } from '../index.js';

function fixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(
    new URL(`../../../../packages/core-rs/crates/mainframe-types/tests/fixtures/${name}`, import.meta.url),
  );
  const { _provenance, ...event } = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  expect(_provenance).toBe('synthetic');
  return event;
}

const featureOffer: WorktreeSwitchOffer = {
  chatId: 'chat_9f2a3b1c',
  worktreePath: '/Users/dev/code/mainframe/.worktrees/feat-switch-offer',
  branchName: 'feat/switch-offer',
  detectedAt: 1753401660000,
};

const detachedOffer: WorktreeSwitchOffer = {
  chatId: 'chat_9f2a3b1c',
  worktreePath: '/Users/dev/code/mainframe/.worktrees/detached-head',
  branchName: null,
  detectedAt: 1753401600000,
};

describe('worktree.offer.* fixtures match the TS DaemonEvent union', () => {
  it('raised carries a detached offer in minimal and a branch in full', () => {
    const minimal: DaemonEvent = {
      type: 'worktree.offer.raised',
      chatId: 'chat_9f2a3b1c',
      offer: detachedOffer,
    };
    const full: DaemonEvent = {
      type: 'worktree.offer.raised',
      chatId: 'chat_9f2a3b1c',
      offer: featureOffer,
    };
    expect(fixture('event.worktree-offer-raised.json')).toEqual({ minimal, full });
  });

  it('resolved carries the path and the outcome', () => {
    const resolved: DaemonEvent = {
      type: 'worktree.offer.resolved',
      chatId: 'chat_9f2a3b1c',
      worktreePath: '/Users/dev/code/mainframe/.worktrees/feat-switch-offer',
      outcome: 'accepted',
    };
    expect(fixture('event.worktree-offer-resolved.json')).toEqual(resolved);
  });

  it('snapshot carries an empty list in minimal and both offer shapes in full', () => {
    const minimal: DaemonEvent = {
      type: 'worktree.offer.snapshot',
      chatId: 'chat_9f2a3b1c',
      offers: [],
    };
    const full: DaemonEvent = {
      type: 'worktree.offer.snapshot',
      chatId: 'chat_9f2a3b1c',
      offers: [featureOffer, { ...detachedOffer, detectedAt: 1753401720000 }],
    };
    expect(fixture('event.worktree-offer-snapshot.json')).toEqual({ minimal, full });
  });
});
