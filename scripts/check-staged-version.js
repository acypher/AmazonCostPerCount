const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', 'HEAD').trim().split('\n');
const safariSource = 'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/src/';
const codeChanged = staged.some((file) => file.startsWith('src/') || file.startsWith(safariSource));
if (!codeChanged) process.exit(0);

const stagedText = (file) => git('show', `:${file}`);
const prior = JSON.parse(git('show', 'HEAD:package.json')).version;
const current = JSON.parse(stagedText('package.json')).version;
if (!/^\d+\.\d+\.\d+$/.test(prior) || !/^\d+\.\d+\.\d+$/.test(current)) {
  console.error('Package versions must use three numeric components.');
  process.exit(1);
}
const oldParts = prior.split('.').map(Number);
const newParts = current.split('.').map(Number);
const firstDifference = newParts.findIndex((part, index) => part !== oldParts[index]);
if (firstDifference < 0 || newParts[firstDifference] <= oldParts[firstDifference]) {
  console.error(`Extension code is staged, but the staged version has not increased from ${prior}.`);
  process.exit(1);
}

const manifest = JSON.parse(stagedText('manifest.json')).version;
const safariManifest = JSON.parse(stagedText('safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/manifest.json')).version;
const project = stagedText('safari/Amazon Results CostPerCount/Amazon Results CostPerCount.xcodeproj/project.pbxproj');
const safariVersions = [...project.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map((match) => match[1]);
if (manifest !== current || safariManifest !== current || !safariVersions.length ||
    safariVersions.some((value) => value !== current)) {
  console.error(`All staged release versions must match ${current}.`);
  process.exit(1);
}
