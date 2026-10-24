const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const releasePaths = [
  'src', 'ocr',
  'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/ocr',
  'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/src',
  'package.json',
  'manifest.json',
  'safari/Amazon Results CostPerCount/Amazon Results CostPerCount Extension/Resources/manifest.json',
  'safari/Amazon Results CostPerCount/Amazon Results CostPerCount.xcodeproj/project.pbxproj',
];
const status = execFileSync('git', ['status', '--short', '--untracked-files=all', '--', ...releasePaths],
  { cwd: root, encoding: 'utf8' }).trim();
if (status) {
  console.error(`Extension source or version changes remain uncommitted:\n${status}`);
  process.exit(1);
}
console.log('Extension source and version declarations are committed.');
