/** Result strings are the CLI's wording from a real `/design` run (CLI 2.1.318). */
import { describe, expect, it } from 'vitest';
import { describeArtifactCall } from '../artifact-call';

const ARTIFACT = 'https://claude.ai/artifact/V1LAdjrXoKC7jVLpHnV1D2';
const TYPE = 'https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd';
const CREATED = `Created a new Artifact at ${ARTIFACT} (version 1793917403-fd1e) from the Artifact type ${TYPE} (release 1).`;

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
