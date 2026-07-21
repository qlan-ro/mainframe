import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  standaloneArtifactName,
  pickRelease,
  assetUrl,
  parseUpdateArgs,
  resolveInstallRoot,
  compareSemver,
  assertNotDowngrade,
  type GhRelease,
} from '../update.js';

function release(tag: string, prerelease: boolean, assetNames: string[] = []): GhRelease {
  return {
    tag_name: tag,
    prerelease,
    assets: assetNames.map((name) => ({
      name,
      browser_download_url: `https://example.com/${tag}/${name}`,
    })),
  };
}

describe('standaloneArtifactName', () => {
  it('maps supported platform/arch pairs to the release artifact name', () => {
    expect(standaloneArtifactName('linux', 'x64')).toBe('mainframe-daemon-linux-x64.tar.gz');
    expect(standaloneArtifactName('linux', 'arm64')).toBe('mainframe-daemon-linux-arm64.tar.gz');
    expect(standaloneArtifactName('darwin', 'arm64')).toBe('mainframe-daemon-darwin-arm64.tar.gz');
  });

  it('rejects unsupported platforms', () => {
    expect(() => standaloneArtifactName('win32', 'x64')).toThrow(/Unsupported platform/);
    expect(() => standaloneArtifactName('linux', 'ia32')).toThrow(/Unsupported platform/);
  });
});

describe('pickRelease', () => {
  const list = [release('v2.1.0-rc.1', true), release('v2.0.0', false), release('v1.9.0', false)];

  it('defaults to the newest stable release, skipping pre-releases', () => {
    expect(pickRelease(list, {}).tag_name).toBe('v2.0.0');
  });

  it('picks the newest pre-release when --pre is set', () => {
    expect(pickRelease(list, { includePrerelease: true }).tag_name).toBe('v2.1.0-rc.1');
  });

  it('selects an explicit version, with or without a leading v', () => {
    expect(pickRelease(list, { version: 'v1.9.0' }).tag_name).toBe('v1.9.0');
    expect(pickRelease(list, { version: '1.9.0' }).tag_name).toBe('v1.9.0');
  });

  it('ignores draft releases', () => {
    const withDraft = [{ ...release('v3.0.0', false), draft: true }, release('v2.0.0', false)];
    expect(pickRelease(withDraft, {}).tag_name).toBe('v2.0.0');
  });

  it('hints at --pre when only pre-releases exist', () => {
    expect(() => pickRelease([release('v2.0.0-rc.1', true)], {})).toThrow(/mainframe update --pre/);
  });

  it('throws for an unknown explicit version', () => {
    expect(() => pickRelease(list, { version: 'v9.9.9' })).toThrow(/No release found for version/);
  });
});

describe('assetUrl', () => {
  it('returns the download URL for a matching asset', () => {
    const r = release('v2.0.0', false, ['mainframe-daemon-linux-x64.tar.gz']);
    expect(assetUrl(r, 'mainframe-daemon-linux-x64.tar.gz')).toBe(
      'https://example.com/v2.0.0/mainframe-daemon-linux-x64.tar.gz',
    );
  });

  it('throws when the artifact is absent from the release', () => {
    const r = release('v2.0.0', false, ['mainframe-daemon-darwin-arm64.tar.gz']);
    expect(() => assetUrl(r, 'mainframe-daemon-linux-x64.tar.gz')).toThrow(/does not include/);
  });
});

describe('parseUpdateArgs', () => {
  it('parses flags and their values', () => {
    expect(parseUpdateArgs(['--pre'])).toEqual({ includePrerelease: true });
    expect(parseUpdateArgs(['--version', 'v2.0.0-rc.1'])).toEqual({ version: 'v2.0.0-rc.1' });
    expect(parseUpdateArgs(['--dir', '/opt/mf'])).toEqual({ dir: '/opt/mf' });
    expect(parseUpdateArgs(['--force'])).toEqual({ force: true });
    expect(parseUpdateArgs(['--help'])).toEqual({ help: true });
  });

  it('rejects unknown arguments', () => {
    expect(() => parseUpdateArgs(['--nope'])).toThrow(/Unknown argument/);
  });
});

describe('compareSemver', () => {
  it('compares major, minor, and patch numerically', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('ranks a release above a prerelease of the same core version', () => {
    expect(compareSemver('2.0.0', '2.0.0-rc.8')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0-rc.8', '2.0.0')).toBeLessThan(0);
  });

  it('ranks a prerelease of a higher core version above an older stable release', () => {
    expect(compareSemver('v2.0.0-rc.8', 'v1.0.0')).toBeGreaterThan(0);
  });

  it('compares prerelease identifiers numerically when both sides are numeric', () => {
    expect(compareSemver('2.0.0-rc.9', '2.0.0-rc.10')).toBeLessThan(0);
  });

  it('tolerates a leading v on either side', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0);
  });
});

describe('assertNotDowngrade', () => {
  it('allows installing a strictly newer release', () => {
    expect(() => assertNotDowngrade(release('v2.0.0-rc.8', true), '1.0.0', false)).not.toThrow();
  });

  it('refuses to install a release that is not newer than the running version', () => {
    expect(() => assertNotDowngrade(release('v1.0.0', false), '2.0.0-rc.6', false)).toThrow(
      /not newer than the running version/,
    );
  });

  it('refuses to install the same release again', () => {
    expect(() => assertNotDowngrade(release('v1.0.0', false), '1.0.0', false)).toThrow(
      /not newer than the running version/,
    );
  });

  it('allows a downgrade when force is set', () => {
    expect(() => assertNotDowngrade(release('v1.0.0', false), '2.0.0-rc.6', true)).not.toThrow();
  });
});

describe('resolveInstallRoot', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function standaloneLayout(): string {
    const root = mkdtempSync(join(tmpdir(), 'mf-root-'));
    dirs.push(root);
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'daemon.cjs'), '// daemon');
    return root;
  }

  it('uses MAINFRAME_STANDALONE_ROOT when it points at a real install', () => {
    const root = standaloneLayout();
    expect(resolveInstallRoot({ MAINFRAME_STANDALONE_ROOT: root }, '/usr/bin/node')).toBe(root);
  });

  it('falls back to deriving the root from the bundled node path', () => {
    const root = standaloneLayout();
    // <root>/bin/node → <root>
    expect(resolveInstallRoot({}, join(root, 'bin', 'node'))).toBe(root);
  });

  it('throws with install-script guidance when no standalone layout is found', () => {
    expect(() => resolveInstallRoot({}, '/usr/bin/node')).toThrow(/install script/);
  });
});
