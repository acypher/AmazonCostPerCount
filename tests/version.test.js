const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const safari = 'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/manifest.json';
const project = 'safari/Amazon Results CostPerCount/Amazon Results CostPerCount.xcodeproj/project.pbxproj';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const version = (file) => JSON.parse(read(file)).version;

test('browser and Safari release versions agree', () => {
  const expected = version('package.json');
  assert.match(expected, /^\d+\.\d+\.\d+$/);
  assert.equal(version('manifest.json'), expected);
  assert.equal(version(safari), expected);
  const safariVersions = [...read(project).matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((match) => match[1]);
  assert.ok(safariVersions.length > 0, 'Safari marketing versions were not found');
  assert.ok(safariVersions.every((value) => value === expected), 'Safari marketing versions differ');
});

test('uncommitted extension code requires a version bump', (t) => {
  let changed;
  let committedVersion;
  try {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src', 'ocr',
      'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/ocr',
      'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/src'],
    { cwd: root, encoding: 'utf8' }).trim();
    changed += execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src', 'ocr',
      'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/ocr',
      'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/src'],
    { cwd: root, encoding: 'utf8' });
    committedVersion = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'],
      { cwd: root, encoding: 'utf8' })).version;
  } catch {
    t.skip('Git history is unavailable in this copy');
    return;
  }
  if (changed) {
    const current = version('package.json').split('.').map(Number);
    const previous = committedVersion.split('.').map(Number);
    const increased = current.findIndex((value, index) => value !== previous[index]);
    assert.ok(increased >= 0 && current[increased] > previous[increased],
      `Extension code changed without a version bump:\n${changed}`);
  }
});


test('all declared content scripts ship identically in browser and Safari', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const safariManifest = JSON.parse(read(safari));
  assert.deepEqual(manifest.content_scripts, safariManifest.content_scripts);
  const resources = 'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/';
  for (const script of manifest.content_scripts.flatMap(entry => [...entry.js, ...entry.css])) {
    assert.equal(read(script), read(resources + script), script);
  }
  assert.ok(manifest.content_scripts[0].js.indexOf('src/comparison.js') < manifest.content_scripts[0].js.indexOf('src/content.js'));
});

test('local OCR code, model, permissions and assets ship identically for Safari', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const safariManifest = JSON.parse(read(safari));
  assert.deepEqual(manifest, safariManifest);
  const resources = path.join(root, path.dirname(safari));
  for (const file of fs.readdirSync(path.join(root, 'ocr'), { recursive: true })) {
    if (path.basename(file).startsWith('.')) continue;
    const source = path.join(root, 'ocr', file);
    if (!fs.statSync(source).isFile()) continue;
    assert.ok(fs.readFileSync(source).equals(fs.readFileSync(path.join(resources, 'ocr', file))), file);
  }
  assert.deepEqual(manifest.host_permissions, ['https://m.media-amazon.com/*', 'https://images-na.ssl-images-amazon.com/*']);
  assert.match(manifest.content_security_policy.extension_pages, /wasm-unsafe-eval/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /'unsafe-eval'/);
  assert.equal(manifest.web_accessible_resources[0].resources[0], 'ocr/host.html');
  assert.match(read(project), /ocr in Resources/);
  assert.match(read(project), /path = Resources\/ocr/);
});
