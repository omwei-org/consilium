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

assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[{dispatchId:'dispatch-123456789012'}]}))), {status:'awaiting_extension_approval',source:'extension_pending'}, 'pending extension record must reconcile as awaiting approval');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'prepared_for_manual_send',tabId:11}]}))), {status:'prepared_for_manual_send',source:'extension_attempt',tabId:11}, 'confirmed preparation must not be confused with sending');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'cancelled_before_approval'}]}))), {status:'cancelled_before_approval',source:'extension_attempt'}, 'confirmed cancellation before approval must reconcile as a terminal state');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'rejected_before_approval'}]}))), {status:'rejected_before_approval',source:'extension_attempt'}, 'confirmed rejection before approval must reconcile as a terminal state');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'outcome_unknown'}]}))), {status:'outcome_unknown',source:'extension_attempt',reason:'outcome_unknown'}, 'ambiguous extension attempt must remain unknown');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'manually_reviewed'}]}))), {status:'manually_reviewed_outcome_still_unknown',source:'extension_attempt',reason:'manual_review_does_not_prove_delivery'}, 'manual inspection must not be interpreted as delivery');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012'}, {pendingDispatches:[],dispatchAttempts:[]}))), {status:'outcome_unknown',reason:'not_found_in_extension'}, 'missing extension metadata must remain unknown');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({}, {}))), {status:'outcome_unknown',reason:'missing_dispatch_id'}, 'missing dispatch IDs must fail closed');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'prepared_for_manual_send'}, {pendingDispatches:[{dispatchId:'dispatch-123456789012'}],dispatchAttempts:[]}))), {status:'prepared_for_manual_send',source:'local_state_preserved',reason:'confirmed_preparation_is_not_rolled_back_by_nonterminal_snapshot',preserved:true}, 'stale pending snapshots must not roll back a locally confirmed preparation');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'prepared_for_manual_send'}, {pendingDispatches:[],dispatchAttempts:[]}))), {status:'prepared_for_manual_send',source:'local_state_preserved',reason:'confirmed_preparation_is_not_rolled_back_by_nonterminal_snapshot',preserved:true}, 'missing ledger data must not erase a locally confirmed preparation');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'prepared_for_manual_send'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'outcome_unknown'}]}))), {status:'prepared_for_manual_send',source:'local_state_preserved',reason:'confirmed_preparation_is_not_rolled_back_by_nonterminal_snapshot',preserved:true}, 'a nonterminal stale attempt must not roll back a confirmed preparation');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'outcome_unknown'}, {pendingDispatches:[{dispatchId:'dispatch-123456789012'}],dispatchAttempts:[]}))), {status:'outcome_unknown',source:'local_state_preserved',reason:'stale_status_cannot_resolve_unknown',preserved:true}, 'stale pending snapshots must not resolve a previously unknown outcome');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'cancelled_before_approval'}, {pendingDispatches:[{dispatchId:'dispatch-123456789012'}],dispatchAttempts:[]}))), {status:'cancelled_before_approval',source:'local_terminal_state',preserved:true}, 'a stale snapshot must not undo a locally recorded terminal cancellation');
assert.deepEqual(JSON.parse(JSON.stringify(core.reconcileDispatch({dispatchId:'dispatch-123456789012',status:'prepared_for_manual_send'}, {pendingDispatches:[],dispatchAttempts:[{dispatchId:'dispatch-123456789012',state:'rejected_before_approval'}]}))), {status:'rejected_before_approval',source:'extension_attempt'}, 'authoritative extension terminal outcomes must override a stale nonterminal local state');


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
assert.match(popup, /CONSILIUM_POPUP_RESOLVE_UNKNOWN/, 'trusted popup must support explicit manual resolution of unknown outcomes');
assert.match(bg, /An earlier dispatch has an unknown outcome/, 'new dispatches must fail closed while an earlier outcome is unknown');
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
assert.match(html, /Close round after manual review/, 'interrupted round must have an explicit manual closure path');
assert.match(app, /Moderator manually abandoned this round after inspecting provider state/, 'manual closure must be recorded in the local audit trail');
assert.match(app, /if\(active\.pendingRound&&!\['complete','abandoned'\]\.includes\(active\.pendingRound\.status\)\)/, 'only completed or manually abandoned rounds may be followed by a new round');
assert.match(bg, /pendingDispatches:Object\.values\(pending\)/, 'extension status must expose pending dispatch metadata for reconciliation');
assert.match(bg, /dispatchAttempts:Object\.values\(attempts\)/, 'extension status must expose minimal attempt metadata for reconciliation');
assert.match(app, /ConsiliumCore\.reconcileDispatch\(d,r\.status\|\|\{\}\)/, 'hosted UI must use deterministic extension-state reconciliation');
assert.match(coreSource, /manual_review_does_not_prove_delivery/, 'manual review must not be interpreted as proof of delivery');
const content = read('chrome-extension/content.js');
assert.doesNotMatch(content, /\.click\(\)/, 'content script must not auto-click provider Send');
assert.match(content, /Review and click Send manually/, 'manual-send safety copy missing');
assert.match(content, /Composer already contains a draft/, 'provider adapter must not overwrite an existing draft');
assert.match(bg, /case 'CONSILIUM_CANCEL_DISPATCH':\{const id=message\.payload\?\.dispatchId/, 'cancel dispatch must validate the ID before removing a staged request');
assert.match(bg, /if\(inFlightDispatches\.has\(id\)\)throw Error\('Request approval is already in progress/, 'cancel dispatch must fail closed during approval');
assert.doesNotMatch(content, /MutationObserver|CONSILIUM_CAPTURED_RESPONSE|capturedAt/, 'automatic response capture must remain disabled until the complete protocol is implemented');
assert.match(app, /catch\(err\)\{toast\(err\.message\|\|'Could not build prompt\. Nothing was sent\.'\);return;\}/, 'prompt-size and construction errors must be handled in the UI');
assert.match(app, /\$\('instruction'\)\.value='';/, 'a recorded moderator instruction must not be silently reused next round');
assert.ok(html.indexOf('src="core.js"') < html.indexOf('src="app.js"'), 'core must load before the app');
assert.match(html, /id="round-status-text"/, 'visible current-round status must be present');
assert.match(app, /currentResponses=PROVIDERS\.filter\(p=>active\.messages\.some\(m=>m\.sender===p&&m\.kind==='response'&&Number\(m\.round\)===currentRound\)\)/, 'round summary must count only responses belonging to the current round');
assert.match(app, /currentResponses\.length\+' of 2 responses recorded'/, 'round summary must clearly show response progress');
assert.match(app, /Next: open the Consilium extension popup and approve each staged request/, 'round status must tell the moderator when extension approval is next');
assert.match(app, /Manual round · '\+currentResponses\.length\+' of 2 responses saved/, 'manual rounds must explain that provider responses need to be recorded');
assert.match(app, /\$\('save-'\+p\)\.disabled=!roundOpen/, 'response capture must be disabled when there is no open round or the round is closed');
assert.match(app, /const currentRound=Number\(active\.pendingRound\?\.round\?\?active\.round\)/, 'provider status must use the active round, not merely any historical response');
assert.match(app, /Response saved for round '\+currentRound/, 'provider status must identify a response saved for the current round');
assert.match(app, /Waiting for response for round '\+currentRound/, 'provider status must show when the current round still lacks a response');
assert.match(app, /Latest response is from round '\+\(last\.round\?\?'unknown'\)/, 'provider status must distinguish an older response from a current-round response');
assert.ok(html.includes('id="manual-chatgpt"') && html.includes('id="manual-claude"'), 'recipient-specific manual fallback controls must exist');
assert.ok(html.includes('id="manual-fallback"') && html.includes('id="manual-content"'), 'manual fallback dialog must exist');
assert.ok(app.includes('function openManualFallback(provider)') && app.includes("buildPrompt()"), 'manual fallback must use the context-aware prompt builder');
assert.match(app, /mode:'manual_fallback',promptContent:content/, 'manual fallback must persist the round and the exact shared prompt');
assert.match(app, /content=current\.promptContent/, 'the second provider must receive the same prompt after refresh or a first response');
assert.match(app, /Resolve the active extension round first/, 'manual fallback must not bypass an unresolved extension dispatch');
assert.match(app, /active\.messages\.push\(\{id:uid\(\),round,sender:'moderator',kind:'moderator_instruction'/, 'manual-round moderator instructions must be recorded for later context');
assert.match(app, /mode!=='manual_fallback'&&!\['complete','abandoned'\]\.includes\(active\.pendingRound\.status\)/, 'manual rounds must not show extension-recovery controls');
assert.ok(app.includes('navigator.clipboard.writeText(content)'), 'manual fallback must offer clipboard copy');
assert.ok(app.includes('Could not access clipboard. Prompt selected; copy it manually.'), 'manual fallback must work when clipboard access is unavailable');


const { webcrypto } = await import('node:crypto');
const extensionStorage = {};
let externalHandler, internalHandler;
let holdPrepare=false, failPrepare=false, releasePrepare=()=>{}, prepareStartedResolve=()=>{};
let prepareStarted=new Promise(resolve=>{prepareStartedResolve=resolve;});
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
    async sendMessage(id,message){assert.equal(id,11);assert.equal(message.type,'CONSILIUM_PROVIDER_PREPARE');if(failPrepare)throw Error('simulated provider adapter failure');if(holdPrepare){prepareStartedResolve();await new Promise(resolve=>{releasePrepare=resolve;});}return {ok:true,status:'prepared_for_manual_send'};}
  }
};
const extensionSandbox={chrome:chromeMock,crypto:webcrypto,TextEncoder,URL,Date,Set,Map,Object,Array,String,Error,RegExp,Promise};
vm.runInNewContext(bg,{...extensionSandbox,globalThis:extensionSandbox},{filename:'background.behavior-test.js'});
const invoke=(handler,message,sender)=>new Promise(resolve=>handler(message,sender,resolve));
const sender={url:'https://omwei.tech/'};
const badOrigin=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_PING'},{url:'https://attacker.example/'});
assert.equal(badOrigin.ok,false,'untrusted origin must be rejected');
const behaviorContent='Behavioral test: prepare, do not send.';
const hash=[...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(behaviorContent)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const dispatchId='12345678-1234-1234-1234-123456789012';
const payload={dispatchId,sessionId:'session-test',roundId:'1',recipient:'chatgpt',content:behaviorContent,contentHash:hash,attempt:1};
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
assert.equal(extensionStorage.consiliumDispatchAttempts[secondId].state,'cancelled_before_approval','cancellation must leave a terminal ledger record');
const orderFirst='62345678-1234-1234-1234-123456789012';
const orderSecond='72345678-1234-1234-1234-123456789012';
for(const id of [orderFirst,orderSecond]){
 const r=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:id}},sender);
 assert.equal(r.ok,true,'ordered request should stage');
}
const storedPending=extensionStorage.consiliumPendingDispatches;
storedPending[orderFirst].stagedAt='2026-01-01T00:00:00.000Z';
storedPending[orderSecond].stagedAt='2026-01-01T00:00:01.000Z';
const approveLater=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:orderSecond},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(approveLater.ok,false,'background must refuse approval out of order');
assert.match(approveLater.error,/oldest pending request first/,'out-of-order refusal must be explicit');
const rejectFirst=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_REJECT',dispatchId:orderFirst},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(rejectFirst.ok,true,'oldest request can be explicitly rejected');
assert.equal(extensionStorage.consiliumDispatchAttempts[orderFirst].state,'rejected_before_approval','rejection must leave a terminal ledger record');
const approveNowOldest=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:orderSecond},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(approveNowOldest.ok,true,'next request can be approved after oldest request is resolved');
const multiId='42345678-1234-1234-1234-123456789012';
const multiStage=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:multiId}},sender);
assert.equal(multiStage.ok,true,'multiple-tab test request should stage');
providerTabs.push({id:12,url:'https://chatgpt.com/c/second',title:'ChatGPT second tab'});
const multiApprove=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:multiId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(multiApprove.ok,false,'approval must fail when multiple provider tabs match');
assert.match(multiApprove.error,/Multiple chatgpt tabs/,'multiple-tab failure must be explicit');
providerTabs.pop();
const rejectAmbiguous=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_REJECT',dispatchId:multiId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(rejectAmbiguous.ok,true,'ambiguous multiple-tab request can be explicitly rejected');
const noTabId='52345678-1234-1234-1234-123456789012';
const noTabStage=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:noTabId}},sender);
assert.equal(noTabStage.ok,true,'no-tab test request should stage');
providerTabs.length=0;
const noTabApprove=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:noTabId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(noTabApprove.ok,false,'approval must fail when provider tab is absent');
assert.match(noTabApprove.error,/No chatgpt tab found/,'no-tab failure must be explicit');
providerTabs.push({id:11,url:'https://chatgpt.com/',title:'ChatGPT'});
const stillPending=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_LIST_PENDING'},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.ok(!stillPending.pending.some(p=>p.dispatchId===multiId)&&stillPending.pending.some(p=>p.dispatchId===noTabId),'rejected request should be removed while failed no-tab preflight remains visible');
const rejectNoTab=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_REJECT',dispatchId:noTabId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(rejectNoTab.ok,true,'failed no-tab request can be explicitly rejected after inspection');
const raceId='32345678-1234-1234-1234-123456789012';
const raceStage=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:raceId}},sender);
assert.equal(raceStage.ok,true,'race-test request should stage');
holdPrepare=true;
prepareStarted=new Promise(resolve=>{prepareStartedResolve=resolve;});
const approveInFlight=invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:raceId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
await prepareStarted;
const cancelInFlight=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CANCEL_DISPATCH',payload:{dispatchId:raceId}},sender);
assert.equal(cancelInFlight.ok,false,'cancellation must fail closed while approval is in flight');
assert.match(cancelInFlight.error,/already in progress/,'in-flight cancellation failure must explain the ambiguous state');
const rejectInFlight=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_REJECT',dispatchId:raceId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(rejectInFlight.ok,false,'rejection must fail closed while approval is in flight');
assert.match(rejectInFlight.error,/already being approved/,'in-flight rejection failure must explain the ambiguous state');
releasePrepare();
const approvedInFlight=await approveInFlight;
holdPrepare=false;
assert.equal(approvedInFlight.ok,true,'the already-started approval should resolve after manual preparation');


const contentSource=read('chrome-extension/content.js');
let contentHandler;
class FakeTextArea {
  constructor(value=''){this._value=value;this.disabled=false;this.isConnected=true;this.isContentEditable=false;this.focused=false;this.events=[];}
  get value(){return this._value;}
  set value(v){this._value=v;}
  getBoundingClientRect(){return {width:240,height:60};}
  getAttribute(){return null;}
  focus(){this.focused=true;}
  dispatchEvent(e){this.events.push(e);return true;}
}
class FakeInputEvent {constructor(type,init){this.type=type;Object.assign(this,init);}}
let visibleComposers=[];
const fakeDocument={querySelectorAll(selector){if(selector==='#prompt-textarea')return visibleComposers;return [];}};
const contentSandbox={chrome:{runtime:{id:chromeMock.runtime.id,onMessage:{addListener:fn=>{contentHandler=fn;}}}},location:{hostname:'chatgpt.com'},document:fakeDocument,HTMLTextAreaElement:FakeTextArea,HTMLInputElement:class FakeInput{},InputEvent:FakeInputEvent,Error,String,Array};
vm.runInNewContext(contentSource,{...contentSandbox,globalThis:contentSandbox},{filename:'content.behavior-test.js'});
const contentMessage=(recipient='chatgpt',text='A reviewed prompt')=>new Promise(resolve=>contentHandler({protocolVersion:1,type:'CONSILIUM_PROVIDER_PREPARE',payload:{dispatchId:'content-test-123456789012',recipient,content:text,contentHash:'not-rechecked-here'}},{id:chromeMock.runtime.id},resolve));
const emptyComposer=new FakeTextArea('');
visibleComposers=[emptyComposer];
const prepared=await contentMessage();
assert.equal(prepared.ok,true,'supported empty composer should accept the reviewed text');
assert.equal(emptyComposer.value,'A reviewed prompt','adapter must insert the exact approved text');
assert.equal(emptyComposer.focused,true,'adapter should focus the target composer');
assert.equal(emptyComposer.events.length,1,'adapter should dispatch an input event for framework state');
const draftComposer=new FakeTextArea('my unsent draft');
visibleComposers=[draftComposer];
const draftResult=await contentMessage();
assert.equal(draftResult.ok,false,'adapter must refuse a non-empty composer');
assert.equal(draftComposer.value,'my unsent draft','existing draft must remain unchanged');
visibleComposers=[new FakeTextArea(''),new FakeTextArea('')];
const ambiguousComposer=await contentMessage();
assert.equal(ambiguousComposer.ok,false,'adapter must refuse multiple matching composers');
visibleComposers=[new FakeTextArea('')];
const wrongProvider=await contentMessage('claude');
assert.equal(wrongProvider.ok,false,'adapter must refuse a recipient/provider mismatch');


const unknownId='82345678-1234-1234-1234-123456789012';
const unknownPayload={...payload,dispatchId:unknownId};
const unknownStage=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:unknownPayload},sender);
assert.equal(unknownStage.ok,true,'unknown-outcome test request should stage');
failPrepare=true;
const unknownApprove=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_APPROVE',dispatchId:unknownId},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
failPrepare=false;
assert.equal(unknownApprove.ok,false,'provider adapter failure must not report successful preparation');
assert.equal(extensionStorage.consiliumDispatchAttempts[unknownId].state,'outcome_unknown','failed adapter delivery must be durably recorded as outcome unknown');
assert.equal(extensionStorage['consilium.dispatch.'+unknownId]!==undefined,true,'dispatch ID must remain consumed after ambiguous delivery');
const statusUnknown=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_GET_STATUS'},sender);
assert.ok(statusUnknown.status.unresolvedAttempts.some(x=>x.dispatchId===unknownId),'status must expose unresolved outcome after adapter failure');
const workerRestartSandbox={...extensionSandbox};
vm.runInNewContext(bg,{...workerRestartSandbox,globalThis:workerRestartSandbox},{filename:'background.restart-test.js'});
const statusAfterRestart=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_GET_STATUS'},sender);
assert.ok(statusAfterRestart.status.unresolvedAttempts.some(x=>x.dispatchId===unknownId),'outcome-unknown record must survive simulated service-worker restart');


const blockedAfterUnknown=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:'92345678-1234-1234-1234-123456789012'}},sender);
assert.equal(blockedAfterUnknown.ok,false,'new dispatches must be blocked while any outcome remains unknown');
assert.match(blockedAfterUnknown.error,/unknown outcome/,'block must explain unresolved ambiguity');
const resolvedUnknown=await invoke(internalHandler,{protocolVersion:1,type:'CONSILIUM_POPUP_RESOLVE_UNKNOWN',dispatchId:unknownId,confirmation:'inspected_provider_tabs'},{id:chromeMock.runtime.id,url:'chrome-extension://'+chromeMock.runtime.id+'/popup.html'});
assert.equal(resolvedUnknown.ok,true,'trusted popup can record explicit manual inspection');
assert.equal(extensionStorage.consiliumDispatchAttempts[unknownId].state,'manually_reviewed','manual resolution must be durably recorded');
const allowedAfterReview=await invoke(externalHandler,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{...payload,dispatchId:'a2345678-1234-1234-1234-123456789012'}},sender);
assert.equal(allowedAfterReview.ok,true,'new staging can resume only after manual review is recorded');

console.log('Behavioral extension protocol tests passed.');

console.log('Consilium static checks passed.');
