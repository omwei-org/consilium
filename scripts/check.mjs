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
assert.equal(manifest.action.default_popup, 'popup.html', 'toolbar action must open trusted approval popup');

for (const file of ['web-ui/core.js', 'web-ui/app.js', 'chrome-extension/background.js', 'chrome-extension/content.js', 'chrome-extension/popup.js']) {
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
assert.ok(prompt.includes('ORIGINAL INTENT') && prompt.includes('Choose a deployment approach'), 'original intent must be preserved');
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
assert.match(coreSource, /m\.kind==='response'\|\|m\.kind==='moderator_instruction'/, 'future context must include responses and moderator instructions');
assert.match(app, /async function saveManualResponse/, 'manual response capture must be implemented');
assert.match(app, /This response is already saved for the current round/, 'duplicate response capture must be prevented');
assert.match(html, /id="save-chatgpt"/, 'ChatGPT response control must exist in HTML');
assert.match(html, /id="save-claude"/, 'Claude response control must exist in HTML');
const bg = read('chrome-extension/background.js');
assert.match(bg, /contentHash/, 'dispatch must validate content hash');
assert.match(bg, /already consumed/, 'dispatch IDs must be single-use');
assert.match(bg, /do not retry automatically/, 'ambiguous delivery must not be retried');
const popup = read('chrome-extension/popup.js');
assert.match(popup, /CONSILIUM_POPUP_APPROVE/, 'trusted popup must approve staged requests');
assert.match(popup, /CONSILIUM_POPUP_REJECT/, 'trusted popup must reject staged requests');
assert.match(popup, /sort\(\(a,b\)=>String\(a\.stagedAt\)/, 'popup must order requests deterministically');
assert.match(bg, /sender\.url!==expectedUrl/, 'only the extension-owned popup may approve');
assert.match(bg, /awaiting_extension_approval/, 'webpage requests must stage instead of dispatching');
assert.match(app, /status:'awaiting_extension_approval'/, 'hosted UI must not report staged requests as already prepared');
assert.match(app, /stagedDispatches\.push\(\{dispatchId,provider:item\.provider,round:item\.round\}\)/, 'hosted UI must track staged dispatch IDs');
assert.match(app, /type:'CONSILIUM_CANCEL_DISPATCH',payload:\{dispatchId:item\.dispatchId\}/, 'cancelled rounds must attempt to cancel pending extension requests');
assert.match(app, /could not be confirmed cancelled/, 'failed remote cancellation must be surfaced to the moderator');
assert.match(app, /pendingRound=\{round,status:'preparing'/, 'round recovery state must be persisted before dispatch begins');
assert.match(html, /Reconcile extension state/, 'recovery UI must offer extension reconciliation');
assert.match(app, /No dispatch will be retried automatically/, 'recovery must explicitly prohibit automatic retry');
assert.match(app, /Resolve the current round first/, 'new rounds must wait until the previous round is complete');
assert.match(bg, /pendingDispatches:Object\.values\(pending\)/, 'extension status must expose pending dispatch metadata for reconciliation');
const content = read('chrome-extension/content.js');
assert.doesNotMatch(content, /\.click\(\)/, 'content script must not auto-click provider Send');
assert.match(content, /Review and click Send manually/, 'manual-send safety copy missing');
assert.match(content, /Composer already contains a draft/, 'provider adapter must not overwrite an existing draft');
assert.match(bg, /case 'CONSILIUM_CANCEL_DISPATCH':\{const s=await chrome\.storage\.local\.get\(PENDING_KEY\)/, 'cancel dispatch must remove a staged request');
assert.doesNotMatch(content, /MutationObserver|CONSILIUM_CAPTURED_RESPONSE|capturedAt/, 'automatic response capture must remain disabled until the complete protocol is implemented');
assert.match(app, /catch\(err\)\{toast\(err\.message\|\|'Could not build prompt\. Nothing was sent\.'\);return;\}/, 'prompt-size and construction errors must be handled in the UI');
assert.match(app, /\$\('instruction'\)\.value='';/, 'a recorded moderator instruction must not be silently reused next round');
assert.ok(html.indexOf('src="core.js"') < html.indexOf('src="app.js"'), 'core must load before the app');


const { webcrypto } = await import('node:crypto');
const extensionStorage = {};
let externalHandler, internalHandler;
const providerTabs = [{id:11,url:'https://chatgpt.com/',title:'ChatGPT'}];
const chromeMock = {
  runtime: {
    id:'abcdefghijklmnopabcdefghijklmnop',
    getManifest:()=>({version:'0.1.0'}),
    onMessageExternal:{addListener:fn=>{externalHandler=fn;}},
    onMessage:{addListener:fn=>{internalHandler=fn;}},
    onInstalled:{addListener:()=>{}}
  },
  storage:{local:{
    async get(keys){if(Array.isArray(keys)){const out={};for(const k of keys)if(k in extensionStorage)out[k]=extensionStorage[k];return out;}if(typeof keys==='string')return keys in extensionStorage?{[keys]:extensionStorage[keys]}:{};return {...extensionStorage};},
    async set(values){Object.assign(extensionStorage,values);}
  }},
  tabs:{
    async query(){return providerTabs.map(x=>({...x}));},
    async get(id){const t=providerTabs.find(x=>x.id===id);if(!t)throw Error('tab missing');return {...t};},
    async sendMessage(id,message){assert.equal(id,11);assert.equal(message.type,'CONSILIUM_PROVIDER_PREPARE');return {ok:true,status:'prepared_for_manual_send'};}
  }
};
const extensionSandbox={chrome:chromeMock,crypto:webcrypto,URL,Date,Set,Map,Object,Array,String,Error,RegExp,Promise};
vm.runInNewContext(bg,{...extensionSandbox,globalThis:extensionSandbox},{filename:'background.behavior-test.js'});
const invoke=(handler,message,sender)=>new Promise(resolve=>handler(message,sender,resolve));
const sender={url:'https://omwei.tech/'};
const badOrigin=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_PING'},{url:'https://attacker.example/'});
assert.equal(badOrigin.ok,false,'untrusted origin must be rejected');
const content='Behavioral test: prepare, do not send.';
const hash=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const dispatchId='12345678-1234-1234-1234-123456789012';
const payload={dispatchId,sessionId:'session-test',roundId:'1',recipient:'chatgpt',content,contentHash:hash,attempt:1};
const staged=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload},sender);
assert.equal(staged.ok,true,'valid request must be staged');
assert.equal(staged.status,'awaiting_extension_approval','staging must not dispatch automatically');
const pending=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_LIST_PENDING'},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(pending.pending.length,1,'popup must see staged request');
const forged=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/other.html'});
assert.equal(forged.ok,false,'non-popup extension page must not approve');
const approved=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(approved.ok,true,'trusted popup should approve a valid pending request');
assert.equal(approved.status,'prepared_for_manual_send','approval should prepare text for manual send');
const duplicate=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload},sender);
assert.equal(duplicate.ok,false,'consumed dispatch ID must not be staged again');
const secondId='22345678-1234-1234-1234-123456789012';
const cancelled=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:secondId}},sender);
assert.equal(cancelled.ok,true,'second valid dispatch should stage');
const cancelResult=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CANCEL_DISPATCH',payload:{dispatchId:secondId}},sender);
assert.equal(cancelResult.ok,true,'pending dispatch cancellation should succeed');
const afterCancel=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_GET_STATUS'},sender);
assert.equal(afterCancel.status.pendingCount,0,'cancelled request must be removed from pending status');
console.log('Behavioral extension protocol tests passed.');

console.log('Consilium static checks passed.');
