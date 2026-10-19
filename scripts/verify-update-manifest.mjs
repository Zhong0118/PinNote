import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep incomplete matrix builds in draft, away from the public updater endpoint.
export function validateManifest(manifest, release, signatures, tag) {
  assert.equal(release.tagName, tag, 'Release tag mismatch');
  assert.equal(manifest.version.replace(/^v/, ''), tag.replace(/^v/, ''), 'Update version mismatch');
  const targets = {
    'darwin-aarch64': '.app.tar.gz',
    'darwin-x86_64': '.app.tar.gz',
    'windows-x86_64-nsis': '.exe',
    'windows-x86_64-msi': '.msi',
  };
  for (const [target, extension] of Object.entries(targets)) {
    const entry = manifest.platforms[target];
    assert(entry, `Missing update target: ${target}`);
    const url = new URL(entry.url);
    const prefix = `/Zhong0118/PinNote/releases/download/${tag}/`;
    assert(url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(prefix), `Wrong update URL: ${target}`);
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    assert(name.endsWith(extension), `Wrong installer format: ${target}`);
    assert(release.assets.some(asset => asset.name === name && asset.size > 0 && asset.state === 'uploaded'), `Missing uploaded binary: ${name}`);
    assert(entry.signature?.trim(), `Missing signature: ${target}`);
    assert.equal(entry.signature.trim(), signatures[`${name}.sig`]?.trim(), `Signature mismatch: ${target}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, tag] = process.argv.slice(2);
  const readJson = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
  const signatures = Object.fromEntries(readdirSync(directory).filter(name => name.endsWith('.sig'))
    .map(name => [name, readFileSync(resolve(directory, name), 'utf8')]));
  validateManifest(readJson('latest.json'), readJson('release.json'), signatures, tag);
  console.log('Verified updater manifest: macOS ARM/Intel and Windows NSIS/MSI');
}
