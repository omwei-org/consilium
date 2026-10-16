'use strict';
const PROTOCOL_VERSION=1;
const ALLOWED_ORIGINS=new Set(['https://omwei.tech','https://www.omwei.tech','http://localhost','http://127.0.0.1']);
const ALLOWED_EXTERNAL_TYPES=new Set(['CONSILIUM_PING','CONSILIUM_GET_STATUS','CONSILIUM_CONFIRM_DISPATCH','CONSILIUM_CANCEL_DISPATCH']);
const MAX_CONTENT_CHARS=30000;
const inFlightDispatches=new Set();
const PENDING_KEY='consiliumPendingDispatches';
function responseError(error){return {ok:false,protocolVersion:PROTOCOL_VERSION,error};}
function providerFromUrl(value){try{const host=new URL(value).hostname;if(host==='chatgpt.com'||host.endsWith('.chatgpt.com'))return 'chatgpt';if(host==='claude.ai'||host.endsWith('.claude.ai'))return 'claude';}catch{}return null;}
function isAllowedSender(sender){if(!sender?.url||sender.id!==undefined)return false;try{const u=new URL(sender.url);if(ALLOWED_ORIGINS.has(u.origin))return true;return u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1');}catch{return false;}}
async function matchingTabs(){const tabs=await chrome.tabs.query({});const out={chatgpt:[],claude:[]};for(const tab of tabs){const p=providerFromUrl(tab.url||'');if(p)out[p].push({tabId:tab.id,title:(tab.title||p).slice(0,160)});}return out;}
async function status(){const p=await matchingTabs(),s=await chrome.storage.local.get(PENDING_KEY),pending=s[PENDING_KEY]||{};return {providers:{chatgpt:{count:p.chatgpt.length},claude:{count:p.claude.length}},multipleTabs:{chatgpt:p.chatgpt.length>1,claude:p.claude.length>1},pendingCount:Object.keys(pending).length,pendingDispatches:Object.values(pending).map(x=>({dispatchId:x.dispatchId,sessionId:x.sessionId,roundId:x.roundId,recipient:x.recipient,stagedAt:x.stagedAt})),extensionVersion:chrome.runtime.getManifest().version};}
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
 const key='consilium.dispatch.'+dispatchId, existing=await chrome.storage.local.get([key,PENDING_KEY]);
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
 const state=await chrome.storage.local.get([PENDING_KEY]);
 const pending=state[PENDING_KEY]||{},payload=pending[dispatchId];
 if(!payload)throw Error('Pending request no longer exists. Refresh the extension popup.');
 const {sessionId,roundId,recipient,content,contentHash,attempt}=payload;
 if(!['chatgpt','claude'].includes(recipient)||typeof content!=='string'||!content.trim()||content.length>MAX_CONTENT_CHARS||attempt!==1)throw Error('Pending request failed validation.');
 const hash=await hashContent(content);if(hash!==contentHash)throw Error('Pending content changed; request rejected.');
 const consumedKey='consilium.dispatch.'+dispatchId;
 const prior=await chrome.storage.local.get(consumedKey);if(prior[consumedKey])throw Error('Dispatch ID already consumed; manual review required.');
 const tabs=await matchingTabs(),matches=tabs[recipient];if(!matches.length)throw Error('No '+recipient+' tab found.');if(matches.length!==1)throw Error('Multiple '+recipient+' tabs found. Close extra tabs first.');
 const target=matches[0],tab=await chrome.tabs.get(target.tabId);if(providerFromUrl(tab.url||'')!==recipient)throw Error('Target tab changed before approval.');
 await chrome.storage.local.set({[consumedKey]:{consumedAt:new Date().toISOString(),recipient,contentHash:hash,sessionId,roundId}});
 delete pending[dispatchId];await chrome.storage.local.set({[PENDING_KEY]:pending});
 try{
  const result=await chrome.tabs.sendMessage(target.tabId,{protocolVersion:PROTOCOL_VERSION,type:'CONSILIUM_PROVIDER_PREPARE',payload:{dispatchId,recipient,content,contentHash:hash}});
  if(!result?.ok)throw Error(result?.error||'Provider adapter could not prepare the message.');
  return {status:'prepared_for_manual_send',tabId:target.tabId,provider:recipient,detail:'Text inserted for review; click Send manually in the provider tab.'};
 }catch(error){throw Error('Dispatch outcome may be unknown; do not retry automatically. '+error.message);}
 } finally {inFlightDispatches.delete(dispatchId);}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 (async()=>{
  const expectedUrl='chrome-extension://'+chrome.runtime.id+'/popup.html';
  if(sender.id!==chrome.runtime.id||sender.url!==expectedUrl)throw Error('Only the extension approval popup may perform this action.');
  if(message?.protocolVersion!==PROTOCOL_VERSION)throw Error('Invalid internal protocol version.');
  if(message.type==='CONSILIUM_POPUP_LIST_PENDING'){const s=await chrome.storage.local.get(PENDING_KEY);return {ok:true,pending:Object.values(s[PENDING_KEY]||{}).map(p=>({dispatchId:p.dispatchId,recipient:p.recipient,sessionId:p.sessionId,roundId:p.roundId,content:p.content,stagedAt:p.stagedAt}))};}
  if(message.type==='CONSILIUM_POPUP_APPROVE'){return {ok:true,...await dispatchApproved(message.dispatchId)};}
  if(message.type==='CONSILIUM_POPUP_REJECT'){if(inFlightDispatches.has(message.dispatchId))throw Error('This request is already being approved; inspect the provider tab before taking another action.');const s=await chrome.storage.local.get(PENDING_KEY),pending=s[PENDING_KEY]||{};if(!pending[message.dispatchId])throw Error('Pending request no longer exists.');delete pending[message.dispatchId];await chrome.storage.local.set({[PENDING_KEY]:pending});return {ok:true,status:'rejected'};}
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
