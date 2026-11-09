/**
 * Behavior tests for ArtifactCard. Result strings are the CLI's wording from a
 * real `/design` run (CLI 2.1.318).
 *
 * Mocked seams: lib/host (openExternal) and useOpenArtifact, whose own routing has
 * its tests in features/artifacts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describeArtifactCall } from '../artifact-call';

const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
const mockOpen = vi.fn().mockResolvedValue(undefined);
const mockOpening = vi.fn();

vi.mock('@/lib/host', () => ({ useHost: () => ({ shell: { openExternal: mockOpenExternal } }) }));
vi.mock('@/features/artifacts/use-open-artifact', () => ({
  useOpenArtifact: () => ({ open: mockOpen, opening: mockOpening() }),
}));

import { ArtifactCard } from '../ArtifactCard';

const ARTIFACT = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';
const TYPE = 'https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd';
const CREATED = `Created a new Artifact at ${ARTIFACT} (version 1793917403-fd1e) from the Artifact type ${TYPE} (release 1).`;
const UPDATED = `Updated the Artifact at ${ARTIFACT} (Version 2)`;

const noop = () => {};
const partProps = {
  type: 'tool-call' as const,
  toolCallId: 'tc-artifact-001',
  toolName: 'Artifact',
  argsText: '',
  addResult: noop,
  resume: noop,
  respondToApproval: noop,
  status: { type: 'complete' as const },
  artifact: undefined,
  interrupt: undefined,
  parentId: undefined,
  messages: undefined,
  isError: false,
};

function cardElement(args: Record<string, unknown>, result: unknown, isError = false) {
  return (
    <ArtifactCard
      {...(partProps as unknown as React.ComponentProps<typeof ArtifactCard>)}
      args={args as never}
      result={result}
      isError={isError}
    />
  );
}

function renderCard(args: Record<string, unknown>, result: unknown, isError = false) {
  return render(cardElement(args, result, isError));
}

describe('describeArtifactCall', () => {
  it('reads a create-from-type result, skipping the type URL', () => {
    expect(describeArtifactCall({ type_url: TYPE, title: 'Coffee Pricing' }, CREATED)).toEqual({
      verb: 'Create artifact',
      label: 'Coffee Pricing',
      url: ARTIFACT,
      showResult: false,
    });
  });

  it('finds the address of a first publish in its result', () => {
    const call = describeArtifactCall({ file_path: '/tmp/page.html' }, `Published /tmp/page.html at ${ARTIFACT}.`);
    expect(call).toMatchObject({ verb: 'Publish artifact', url: ARTIFACT, label: 'V1LAdjrXoKC7jVLpHnV1D2' });
  });

  it('treats a publish to a known url as a publish, not a create', () => {
    expect(describeArtifactCall({ url: ARTIFACT, type_url: TYPE }, '').verb).toBe('Publish artifact');
  });

  it('never offers the type URL listed by a quickstart as the artifact', () => {
    const call = describeArtifactCall({ action: 'quickstart', intent: 'design' }, `type_url: ${TYPE}`);
    expect(call).toEqual({
      verb: 'Artifact quickstart',
      label: '',
      url: null,
      showResult: false,
    });
  });

  it('keeps the text of a listing action for the user', () => {
    expect(describeArtifactCall({ action: 'list_types' }, 'rows')).toMatchObject({
      verb: 'Artifact list types',
      showResult: true,
    });
  });

  it('opens a read by its url, even with no saved files', () => {
    expect(describeArtifactCall({ action: 'read', url: ARTIFACT }, 'details').url).toBe(ARTIFACT);
  });

  it('ignores a url argument that is not a claude.ai artifact', () => {
    expect(describeArtifactCall({ url: 'https://evil.example/artifact/x' }, '').url).toBeNull();
    expect(describeArtifactCall({ url: `${ARTIFACT}.evil.example` }, '').url).toBeNull();
  });
});

describe('ArtifactCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpening.mockReturnValue(false);
  });

  it('shows the title and never the raw result on success', () => {
    renderCard({ type_url: TYPE, title: 'Coffee Pricing' }, CREATED);
    expect(screen.getByText('Create artifact')).toBeInTheDocument();
    expect(screen.getByText('Coffee Pricing')).toBeInTheDocument();
    expect(screen.queryByText(/Created a new Artifact/)).toBeNull();
  });

  it('opens any named artifact in the workspace', () => {
    renderCard({ action: 'read', url: ARTIFACT }, 'details');
    fireEvent.click(screen.getByTestId('artifact-card-open'));
    expect(mockOpen).toHaveBeenCalledWith(ARTIFACT);
  });

  it('shows the download in progress and blocks a second click', () => {
    mockOpening.mockReturnValue(true);
    renderCard({ url: ARTIFACT }, UPDATED);
    expect(screen.getByTestId('artifact-card-open')).toBeDisabled();
    expect(screen.getByTestId('artifact-card-open')).toHaveTextContent('Opening…');
  });

  it('opens claude.ai from the icon button', () => {
    renderCard({ url: ARTIFACT }, UPDATED);
    fireEvent.click(screen.getByTestId('artifact-card-open-browser'));
    expect(mockOpenExternal).toHaveBeenCalledWith(ARTIFACT);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('offers no actions for a call that names no artifact', () => {
    renderCard({ action: 'list', scope: 'mine' }, 'rows');
    expect(screen.queryByTestId('artifact-card-open')).toBeNull();
  });

  it('offers no actions while the call is in flight', () => {
    renderCard({ url: ARTIFACT }, undefined);
    expect(screen.queryByTestId('artifact-card-open')).toBeNull();
    expect(screen.queryByTestId('artifact-card-open-browser')).toBeNull();
  });

  it('shows the error and no actions when the call failed', () => {
    renderCard({ url: ARTIFACT }, 'Publish refused', true);
    expect(screen.getByTestId('artifact-card-error-body')).toHaveTextContent('Publish refused');
    expect(screen.queryByTestId('artifact-card-open')).toBeNull();
    expect(screen.queryByTestId('artifact-card-open-browser')).toBeNull();
  });
});
