import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { validateManifest } from '../scripts/verify-update-manifest.mjs';

test('the Windows installer keeps the identity used by released PinNote builds', () => {
  const common = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const override = new URL('../src-tauri/tauri.windows.conf.json', import.meta.url);
  const windows = existsSync(override) ? JSON.parse(readFileSync(override, 'utf8')) : {};
  assert.equal(windows.productName ?? common.productName, 'PinNote');
  assert.equal(windows.identifier ?? common.identifier, 'com.pinnote.app');
});

function fixture(repository = 'Zhong0118/InkPin') {
  const names = ['InkPin_universal.app.tar.gz', 'InkPin_x64-setup.exe', 'InkPin_x64.msi'];
  const entries = names.map(name => ({ url: `https://github.com/${repository}/releases/download/v1.1.3/${name}`, signature: `signed-${name}` }));
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
test('historical release manifests can be verified under the old repository path', () => {
  const repository = 'Zhong0118/PinNote';
  const f = fixture(repository);
  assert.doesNotThrow(() => validateManifest(f.manifest, f.release, f.signatures, 'v1.1.3', repository));
});
for (const [name, mutate] of [
  ['missing Windows build', f => delete f.manifest.platforms['windows-x86_64-msi']],
  ['stale version', f => f.manifest.version = '1.1.2'],
  ['URL points to previous release', f => f.manifest.platforms['darwin-aarch64'].url = f.manifest.platforms['darwin-aarch64'].url.replace('v1.1.3', 'v1.1.2')],
  ['URL points to a different repository', f => f.manifest.platforms['darwin-aarch64'].url = f.manifest.platforms['darwin-aarch64'].url.replace('/InkPin/', '/Other/') ],
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
