import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../scripts/verify-update-manifest.mjs';

function fixture() {
  const names = ['PinNote_universal.app.tar.gz', 'PinNote_x64-setup.exe', 'PinNote_x64.msi'];
  const entries = names.map(name => ({ url: `https://github.com/Zhong0118/PinNote/releases/download/v1.1.3/${name}`, signature: `signed-${name}` }));
  return {
    manifest: { version: '1.1.3', platforms: {
      'darwin-aarch64': entries[0], 'darwin-x86_64': entries[0],
      'windows-x86_64-nsis': entries[1], 'windows-x86_64-msi': entries[2],
    } },
    release: { tagName: 'v1.1.3', assets: names.map(name => ({ name, size: 100, state: 'uploaded' })) },
    signatures: Object.fromEntries(names.map(name => [`${name}.sig`, `signed-${name}`])),
  };
}

test('a complete Mac universal and Windows MSI/NSIS release can be published', () => {
  const f = fixture();
  assert.doesNotThrow(() => validateManifest(f.manifest, f.release, f.signatures, 'v1.1.3'));
});
for (const [name, mutate] of [
  ['missing Windows build', f => delete f.manifest.platforms['windows-x86_64-msi']],
  ['stale version', f => f.manifest.version = '1.1.2'],
  ['URL points to previous release', f => f.manifest.platforms['darwin-aarch64'].url = f.manifest.platforms['darwin-aarch64'].url.replace('v1.1.3', 'v1.1.2')],
  ['signature mismatch', f => f.manifest.platforms['windows-x86_64-nsis'].signature = 'wrong'],
  ['empty upload', f => f.release.assets[0].size = 0],
  ['missing binary', f => f.release.assets.pop()],
  ['wrong installer format', f => f.manifest.platforms['windows-x86_64-msi'] = f.manifest.platforms['windows-x86_64-nsis']],
]) {
  test(`publication rejects ${name}`, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => validateManifest(f.manifest, f.release, f.signatures, 'v1.1.3'));
  });
}
