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
  new vm.Script(read(file), { filename: file });
}
const app = read('web-ui/app.js');
assert.match(app, /while\s*\(queue\.length\)/, 'dispatch approvals must be sequential');
assert.match(app, /queue\s*=\s*\[\]/, 'cancel/failure must clear queued approvals');
assert.match(app, /showModal\(\)/, 'approval must be explicitly shown');
assert.match(app, /isDispatching\s*=\s*true/, 'overlapping dispatch sequences must be blocked');
assert.match(app, /content\.length>MAX_CONTENT_CHARS/, 'oversized full context must fail closed');
assert.match(app, /m\.kind==='response'\|\|m\.kind==='moderator_instruction'/, 'future context must include responses and moderator instructions');
assert.match(app, /async function saveManualResponse/, 'manual response capture must be implemented');
assert.match(html, /id="save-chatgpt"/, 'ChatGPT response control must exist in HTML');
const bg = read('chrome-extension/background.js');
assert.match(bg, /contentHash/, 'dispatch must validate content hash');
assert.match(bg, /already consumed/, 'dispatch IDs must be single-use');
assert.match(bg, /do not retry automatically/, 'ambiguous delivery must not be retried');
const html = read('web-ui/index.html');
const content = read('chrome-extension/content.js');
assert.doesNotMatch(content, /\.click\(\)/, 'content script must not auto-click provider Send');
assert.match(content, /Review and click Send manually/, 'manual-send safety copy missing');
console.log('Consilium static checks passed.');
