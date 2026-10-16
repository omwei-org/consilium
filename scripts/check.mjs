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

for (const file of ['web-ui/core.js', 'web-ui/app.js', 'chrome-extension/background.js', 'chrome-extension/content.js']) {
  new vm.Script(read(file), { filename: file });
}
const coreSource = read('web-ui/core.js');
const coreSandbox = {};
vm.runInNewContext(coreSource, { globalThis: coreSandbox });
const core = coreSandbox.ConsiliumCore;
assert.ok(core, 'core module must export the conversation helpers');
const fixture = [
  {sender:'moderator', recipient:'chatgpt', content:'[technical dispatch envelope]', status:'approved'},
  {sender:'chatgpt', kind:'response', round:1, content:'ChatGPT answer'},
  {sender:'system', recipient:'claude', content:'Prepared in claude', status:'prepared'},
  {sender:'claude', kind:'response', round:1, content:'Claude answer'},
  {sender:'moderator', kind:'moderator_instruction', content:'Compare assumptions'}
];
const context = core.conversationContext(fixture);
assert.ok(context.includes('ChatGPT answer') && context.includes('Claude answer'), 'both assistant responses must be included');
assert.ok(context.includes('Compare assumptions'), 'moderator instructions must be included');
assert.ok(!context.includes('technical dispatch envelope') && !context.includes('Prepared in claude'), 'dispatch/system records must be excluded');
assert.ok(context.indexOf('ChatGPT answer') < context.indexOf('Claude answer'), 'response order must be preserved');
const prompt = core.buildPrompt('Choose a deployment approach', fixture, 'Identify unresolved risks');
assert.ok(prompt.includes('ORIGINAL INTENT\\nChoose a deployment approach'), 'original intent must be preserved');
assert.ok(prompt.includes('Identify unresolved risks'), 'current moderator instruction must be included');
assert.throws(() => core.buildPrompt('', [], ''), /Original intent is required/, 'empty intent must fail closed');
assert.equal(core.isDuplicateResponse(fixture,'chatgpt',1,'ChatGPT answer'), true, 'duplicate response must be detected');
assert.equal(core.isDuplicateResponse(fixture,'chatgpt',2,'ChatGPT answer'), false, 'same response text in another round is not a duplicate');
assert.throws(() => core.buildPrompt('intent', [{sender:'claude',kind:'response',content:'x'.repeat(30000)}], ''), /exceeds the supported size/, 'oversized context must fail closed');
const app = read('web-ui/app.js');
const html = read('web-ui/index.html');
assert.match(app, /while\s*\(queue\.length\)/, 'dispatch approvals must be sequential');
assert.match(app, /queue\s*=\s*\[\]/, 'cancel/failure must clear queued approvals');
assert.match(app, /showModal\(\)/, 'approval must be explicitly shown');
assert.match(app, /isDispatching\s*=\s*true/, 'overlapping dispatch sequences must be blocked');
assert.match(app, /content\.length>MAX_CONTENT_CHARS/, 'oversized full context must fail closed');
assert.match(app, /m\.kind==='response'\|\|m\.kind==='moderator_instruction'/, 'future context must include responses and moderator instructions');
assert.match(app, /async function saveManualResponse/, 'manual response capture must be implemented');
assert.match(app, /This response is already saved for the current round/, 'duplicate response capture must be prevented');
assert.match(html, /id="save-chatgpt"/, 'ChatGPT response control must exist in HTML');
assert.match(html, /id="save-claude"/, 'Claude response control must exist in HTML');
const bg = read('chrome-extension/background.js');
assert.match(bg, /contentHash/, 'dispatch must validate content hash');
assert.match(bg, /already consumed/, 'dispatch IDs must be single-use');
assert.match(bg, /do not retry automatically/, 'ambiguous delivery must not be retried');
const content = read('chrome-extension/content.js');
assert.doesNotMatch(content, /\.click\(\)/, 'content script must not auto-click provider Send');
assert.match(content, /Review and click Send manually/, 'manual-send safety copy missing');
console.log('Consilium static checks passed.');
