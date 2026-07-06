/**
 * RunTabStrip — strip height regression (finding 15.5: FilesTabStrip/RunTabStrip/
 * ChatCardHeader must share one uniform 36px strip height, matching the design's
 * `SurfaceTabStrip` and chat surface header, both height:36).
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunPane } from '@/store/run-pane';

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: undefined, chatId: undefined }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({ configs: [], handleLaunch: vi.fn() }),
}));

import { RunTabStrip } from '../RunTabStrip';

const pane: RunPane = { id: 'pane-1', tabs: [], active: null };

describe('RunTabStrip — strip height', () => {
  it('has the fixed h-[36px] height class', () => {
    const { container } = render(<RunTabStrip pane={pane} primary />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('h-[36px]');
  });
});
