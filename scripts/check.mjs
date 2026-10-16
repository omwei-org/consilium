import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const manifest = JSON.parse(read('chrome-extension/manifest.json'));
assert.equal(manifest.manifest_version, 3, 'extension must use Manifest V3');
assert.ok(manifest.externally_connectable.matches.includes('https://omwei.tech/*'), 'production origin must be allowed');
assert.ok(manifest.host_permissions.includes('https://chatgpt.com/*'), 'ChatGPT host permission missing');
assert.ok(manifest.host_permissions.includes('https://claude.ai/*'), 'Claude host permission missing');

for (const file of ['web-ui/app.js', 'chrome-extension/background.js', 'chrome-extension/content.js']) {
  const source = read(file);
  new vm.Script(source, { filename: file });
}

const app = read('web-ui/app.js');
assert.match(app, /state\.approvalQueue = PROVIDERS\.map/, 'recipient approvals must be queued');
assert.match(app, /async function openNextApproval\(/, 'sequential approval handler missing');
assert.match(app, /function cancelApprovalSequence\(\)[\s\S]*state\.approvalQueue = \[\]/, 'cancel must clear queued approvals');
const content = read('chrome-extension/content.js');
assert.doesNotMatch(content, /\.click\(\)/, 'content script must not auto-click provider Send');
assert.match(content, /Review and click Send manually/, 'manual send safety copy missing');

console.log('Consilium static checks passed.');
