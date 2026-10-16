'use strict';
const PROTOCOL_VERSION=1;
const ALLOWED_ORIGINS=new Set(['https://omwei.tech','https://www.omwei.tech','http://localhost','http://127.0.0.1']);
const ALLOWED_EXTERNAL_TYPES=new Set(['CONSILIUM_PING','CONSILIUM_GET_STATUS','CONSILIUM_CONFIRM_DISPATCH','CONSILIUM_CANCEL_DISPATCH']);
const MAX_CONTENT_CHARS=30000;
const inFlightDispatches=new Set();
const PENDING_KEY='consiliumPendingDispatches';
const ATTEMPTS_KEY='consiliumDispatchAttempts';
async function saveAttempt(dispatchId,record){const s=await chrome.storage.local.get(ATTEMPTS_KEY),all=s[ATTEMPTS_KEY]||{};all[dispatchId]={...record,dispatchId,updatedAt:new Date().toISOString()};const sorted=Object.values(all).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));const kept={};for(const item of sorted.slice(0,50))kept[item.dispatchId]=item;await chrome.storage.local.set({[ATTEMPTS_KEY]:kept});}
function responseError(error){return {ok:false,protocolVersion:PROTOCOL_VERSION,error};}
function providerFromUrl(value){try{const host=new URL(value).hostname;if(host==='chatgpt.com'||host.endsWith('.chatgpt.com'))return 'chatgpt';if(host==='claude.ai'||host.endsWith('.claude.ai'))return 'claude';}catch{}return null;}
function isAllowedSender(sender){if(!sender?.url||sender.id!==undefined)return false;try{const u=new URL(sender.url);if(ALLOWED_ORIGINS.has(u.origin))return true;return u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1');}catch{return false;}}
async function matchingTabs(){const tabs=await chrome.tabs.query({});const out={chatgpt:[],claude:[]};for(const tab of tabs){const p=providerFromUrl(tab.url||'');if(p)out[p].push({tabId:tab.id,title:(tab.title||p).slice(0,160)});}return out;}
async function status(){const p=await matchingTabs(),s=await chrome.storage.local.get([PENDING_KEY,ATTEMPTS_KEY]),pending=s[PENDING_KEY]||{},attempts=s[ATTEMPTS_KEY]||{};return {unresolvedAttempts:Object.values(attempts).filter(x=>x.state==='preparing'||x.state==='outcome_unknown'),providers:{chatgpt:{count:p.chatgpt.length},claude:{count:p.claude.length}},multipleTabs:{chatgpt:p.chatgpt.length>1,claude:p.claude.length>1},pendingCount:Object.keys(pending).length,pendingDispatches:Object.values(pending).map(x=>({dispatchId:x.dispatchId,sessionId:x.sessionId,roundId:x.roundId,recipient:x.recipient,stagedAt:x.stagedAt})),dispatchAttempts:Object.values(attempts).map(x=>({dispatchId:x.dispatchId,state:x.state,sessionId:x.sessionId,roundId:x.roundId,recipient:x.recipient,tabId:x.tabId,updatedAt:x.updatedAt})),extensionVersion:chrome.runtime.getManifest().version};}
async function hashContent(content){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function stage(payload){
 if(!payload||typeof payload!=='object')throw Error('Invalid payload.');
 const {dispatchId,sessionId,roundId,recipient,content,contentHash,attempt}=payload;
 if(typeof dispatchId!=='string'||! /^[\w-]{20,80}$/.test(dispatchId))throw Error('Invalid dispatch ID.');
 if(!['chatgpt','claude'].includes(recipient))throw Error('Recipient is not supported.');
 if(typeof sessionId!=='string'||!sessionId||typeof roundId!=='string'||!roundId)throw Error('Missing session or round ID.');
 if(typeof content!=='string'||!content.trim()||content.length>MAX_CONTENT_CHARS)throw Error('Content is empty or too large.');
 if(typeof contentHash!=='string'||! /^[a-f0-9]{64}$/.test(contentHash)||await hashContent(content)!==contentHash)throw Error('Content hash mismatch.');
 if(attempt!==1)throw Error('Automatic retries are not supported.');
 const key='consilium.dispatch.'+dispatchId, existing=await chrome.storage.local.get([key,PENDING_KEY,ATTEMPTS_KEY]);
 const unresolved=Object.values(existing[ATTEMPTS_KEY]||{}).filter(x=>x.state==='preparing'||x.state==='outcome_unknown');
 if(unresolved.length)throw Error('An earlier dispatch has an unknown outcome. Inspect the provider tab and resolve it in the extension popup before staging more requests.');
 if(existing[key])throw Error('Dispatch ID already consumed; manual review required.');
 const pending=existing[PENDING_KEY]||{};
 if(pending[dispatchId])throw Error('Dispatch ID is already awaiting extension approval.');
 if(Object.keys(pending).length>=10)throw Error('Too many pending requests. Open the extension and resolve them first.');
 pending[dispatchId]={...payload,stagedAt:new Date().toISOString()};
 await chrome.storage.local.set({[PENDING_KEY]:pending});
 return {status:'awaiting_extension_approval',dispatchId,detail:'Open the Consilium extension from the Chrome toolbar and approve this exact message there.'};
}
async function dispatchApproved(dispatchId){
 if(typeof dispatchId!=='string')throw Error('Invalid dispatch ID.');
 if(inFlightDispatches.has(dispatchId))throw Error('Dispatch already in progress; manual review required.');
 inFlightDispatches.add(dispatchId);
 try {
 const state=await chrome.storage.local.get([PENDING_KEY,ATTEMPTS_KEY]);
 const unresolved=Object.values(state[ATTEMPTS_KEY]||{}).filter(x=>x.state==='preparing'||x.state==='outcome_unknown');
 if(unresolved.length)throw Error('An earlier dispatch has an unknown outcome. Resolve it after manual provider-tab inspection before approving another request.');
 const pending=state[PENDING_KEY]||{};
 const ordered=Object.values(pending).sort((a,b)=>String(a.stagedAt).localeCompare(String(b.stagedAt)));
 if(ordered.length&&ordered[0].dispatchId!==dispatchId)throw Error('Resolve the oldest pending request first.');
 const payload=pending[dispatchId];
 if(!payload)throw Error('Pending request no longer exists. Refresh the extension popup.');
 const {sessionId,roundId,recipient,content,contentHash,attempt}=payload;
 if(!['chatgpt','claude'].includes(recipient)||typeof content!=='string'||!content.trim()||content.length>MAX_CONTENT_CHARS||attempt!==1)throw Error('Pending request failed validation.');
 const hash=await hashContent(content);if(hash!==contentHash)throw Error('Pending content changed; request rejected.');
 const consumedKey='consilium.dispatch.'+dispatchId;
 const prior=await chrome.storage.local.get(consumedKey);if(prior[consumedKey])throw Error('Dispatch ID already consumed; manual review required.');
 const tabs=await matchingTabs(),matches=tabs[recipient];if(!matches.length)throw Error('No '+recipient+' tab found.');if(matches.length!==1)throw Error('Multiple '+recipient+' tabs found. Close extra tabs first.');
 const target=matches[0],tab=await chrome.tabs.get(target.tabId);if(providerFromUrl(tab.url||'')!==recipient)throw Error('Target tab changed before approval.');
 await chrome.storage.local.set({[consumedKey]:{consumedAt:new Date().toISOString(),recipient,contentHash:hash,sessionId,roundId},[ATTEMPTS_KEY]:{...(await chrome.storage.local.get(ATTEMPTS_KEY))[ATTEMPTS_KEY]||{},[dispatchId]:{dispatchId,state:'preparing',recipient,sessionId,roundId,contentHash:hash,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}});
 delete pending[dispatchId];await chrome.storage.local.set({[PENDING_KEY]:pending});
 try{
  const result=await chrome.tabs.sendMessage(target.tabId,{protocolVersion:PROTOCOL_VERSION,type:'CONSILIUM_PROVIDER_PREPARE',payload:{dispatchId,recipient,content,contentHash:hash}});
  if(!result?.ok)throw Error(result?.error||'Provider adapter could not prepare the message.');
  await saveAttempt(dispatchId,{state:'prepared_for_manual_send',recipient,sessionId,roundId,contentHash:hash,tabId:target.tabId,preparedAt:new Date().toISOString()});
  return {status:'prepared_for_manual_send',tabId:target.tabId,provider:recipient,detail:'Text inserted for review; click Send manually in the provider tab.'};
 }catch(error){try{await saveAttempt(dispatchId,{state:'outcome_unknown',recipient,sessionId,roundId,contentHash:hash,tabId:target.tabId,error:String(error.message||error).slice(0,500)});}catch{}throw Error('Dispatch outcome may be unknown; do not retry automatically. '+error.message);}
 } finally {inFlightDispatches.delete(dispatchId);}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 (async()=>{
  const expectedUrl='chrome-extension://'+chrome.runtime.id+'/popup.html';
  if(sender.id!==chrome.runtime.id||sender.url!==expectedUrl)throw Error('Only the extension approval popup may perform this action.');
  if(message?.protocolVersion!==PROTOCOL_VERSION)throw Error('Invalid internal protocol version.');
  if(message.type==='CONSILIUM_POPUP_LIST_PENDING'){const s=await chrome.storage.local.get([PENDING_KEY,ATTEMPTS_KEY]);return {ok:true,pending:Object.values(s[PENDING_KEY]||{}).map(p=>({dispatchId:p.dispatchId,recipient:p.recipient,sessionId:p.sessionId,roundId:p.roundId,content:p.content,stagedAt:p.stagedAt})),unresolvedAttempts:Object.values(s[ATTEMPTS_KEY]||{}).filter(x=>x.state==='preparing'||x.state==='outcome_unknown'),dispatchAttempts:Object.values(s[ATTEMPTS_KEY]||{}).map(x=>({dispatchId:x.dispatchId,state:x.state,sessionId:x.sessionId,roundId:x.roundId,recipient:x.recipient,tabId:x.tabId,updatedAt:x.updatedAt}))};}
  if(message.type==='CONSILIUM_POPUP_APPROVE'){return {ok:true,...await dispatchApproved(message.dispatchId)};}
  if(message.type==='CONSILIUM_POPUP_REJECT'){if(inFlightDispatches.has(message.dispatchId))throw Error('This request is already being approved; inspect the provider tab before taking another action.');const s=await chrome.storage.local.get(PENDING_KEY),pending=s[PENDING_KEY]||{};if(!pending[message.dispatchId])throw Error('Pending request no longer exists.');delete pending[message.dispatchId];await chrome.storage.local.set({[PENDING_KEY]:pending});return {ok:true,status:'rejected'};}
  if(message.type==='CONSILIUM_POPUP_RESOLVE_UNKNOWN'){const id=message.dispatchId;if(typeof id!=='string')throw Error('Invalid dispatch ID.');const s=await chrome.storage.local.get(ATTEMPTS_KEY),all=s[ATTEMPTS_KEY]||{},record=all[id];if(!record||!['preparing','outcome_unknown'].includes(record.state))throw Error('No unresolved attempt found for this dispatch.');if(message.confirmation!=='inspected_provider_tabs')throw Error('Manual provider-tab inspection confirmation is required.');all[id]={...record,state:'manually_reviewed',resolution:'operator_confirmed_provider_tabs_inspected',resolvedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await chrome.storage.local.set({[ATTEMPTS_KEY]:all});return {ok:true,status:'manually_reviewed'};}
  throw Error('Unsupported internal action.');
 })().then(sendResponse).catch(e=>sendResponse(responseError(e.message||'Unknown extension error.')));
 return true;
});
chrome.runtime.onMessageExternal.addListener((message,sender,sendResponse)=>{
 (async()=>{
  if(!isAllowedSender(sender))throw Error('Sender origin is not allowed.');
  if(!message||message.protocolVersion!==PROTOCOL_VERSION||!ALLOWED_EXTERNAL_TYPES.has(message.type))throw Error('Invalid protocol version or message type.');
  switch(message.type){
   case 'CONSILIUM_PING':return {ok:true,protocolVersion:1,status:'ready'};
   case 'CONSILIUM_GET_STATUS':return {ok:true,protocolVersion:1,status:await status()};
   case 'CONSILIUM_CONFIRM_DISPATCH':return {ok:true,protocolVersion:1,...await stage(message.payload)};
   case 'CONSILIUM_CANCEL_DISPATCH':{const id=message.payload?.dispatchId;if(typeof id!=='string')throw Error('Invalid dispatch ID.');if(inFlightDispatches.has(id))throw Error('Request approval is already in progress; cancellation cannot be guaranteed. Inspect the provider tab manually.');const s=await chrome.storage.local.get(PENDING_KEY),pending=s[PENDING_KEY]||{};if(!pending[id])throw Error('Pending request not found or already resolved.');delete pending[id];await chrome.storage.local.set({[PENDING_KEY]:pending});return {ok:true,protocolVersion:1,status:'cancelled',dispatchId:id};}
   default:throw Error('Unsupported message type.');
  }
 })().then(sendResponse).catch(e=>sendResponse(responseError(e.message||'Unknown extension error.')));
 return true;
});
chrome.runtime.onInstalled.addListener(()=>{chrome.storage.local.set({consiliumInstalledAt:new Date().toISOString(),consiliumProtocolVersion:PROTOCOL_VERSION});});
