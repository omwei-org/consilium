'use strict';
const PROTOCOL_VERSION = 1;
const ALLOWED_ORIGINS = new Set(['https://omwei.tech','https://www.omwei.tech','http://localhost','http://127.0.0.1']);
const ALLOWED_TYPES = new Set(['CONSILIUM_PING','CONSILIUM_GET_STATUS','CONSILIUM_CONFIRM_DISPATCH','CONSILIUM_CANCEL_DISPATCH']);
const MAX_CONTENT_CHARS = 30000;
const inFlightDispatches = new Set();
function responseError(error){return {ok:false,protocolVersion:PROTOCOL_VERSION,error};}
function providerFromUrl(value){try{const host=new URL(value).hostname;if(host==='chatgpt.com'||host.endsWith('.chatgpt.com'))return 'chatgpt';if(host==='claude.ai'||host.endsWith('.claude.ai'))return 'claude';}catch{}return null;}
function isAllowedSender(sender){if(!sender?.url||sender.id!==undefined)return false;try{const u=new URL(sender.url);if(ALLOWED_ORIGINS.has(u.origin))return true;return u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1');}catch{return false;}}
async function matchingTabs(){const tabs=await chrome.tabs.query({});const out={chatgpt:[],claude:[]};for(const tab of tabs){const p=providerFromUrl(tab.url||'');if(p)out[p].push({tabId:tab.id,title:(tab.title||p).slice(0,160)});}return out;}
async function status(){const p=await matchingTabs();return {providers:{chatgpt:{count:p.chatgpt.length},claude:{count:p.claude.length}},multipleTabs:{chatgpt:p.chatgpt.length>1,claude:p.claude.length>1},extensionVersion:chrome.runtime.getManifest().version};}
async function dispatch(payload){
 if(!payload||typeof payload!=='object')throw Error('Invalid payload.');
 const {dispatchId,sessionId,roundId,recipient,content,contentHash,attempt}=payload;
 if(typeof dispatchId!=='string'||! /^[\w-]{20,80}$/.test(dispatchId))throw Error('Invalid dispatch ID.');
 const key='consilium.dispatch.'+dispatchId;
 if(inFlightDispatches.has(dispatchId))throw Error('Dispatch already in progress; manual review required.');
 const prior=await chrome.storage.local.get(key);if(prior[key])throw Error('Dispatch ID already consumed; manual review required.');
 if(!['chatgpt','claude'].includes(recipient))throw Error('Recipient is not supported.');
 if(typeof sessionId!=='string'||typeof roundId!=='string')throw Error('Missing session or round ID.');
 if(typeof content!=='string'||!content.trim()||content.length>MAX_CONTENT_CHARS)throw Error('Content is empty or too large.');
 if(typeof contentHash!=='string'||! /^[a-f0-9]{64}$/.test(contentHash))throw Error('Invalid content hash.');
 if(attempt!==1)throw Error('Automatic retries are not supported.');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==contentHash)throw Error('Content hash mismatch; approval is invalid.');
 const tabs=await matchingTabs(),matches=tabs[recipient];if(!matches.length)throw Error('No '+recipient+' tab found.');if(matches.length!==1)throw Error('Multiple '+recipient+' tabs found. Close extra tabs first.');
 const target=matches[0],tab=await chrome.tabs.get(target.tabId);if(providerFromUrl(tab.url||'')!==recipient)throw Error('Target tab changed before dispatch.');
 inFlightDispatches.add(dispatchId);
 await chrome.storage.local.set({[key]:{consumedAt:new Date().toISOString(),recipient,contentHash:hash}});
 try{const result=await chrome.tabs.sendMessage(target.tabId,{protocolVersion:PROTOCOL_VERSION,type:'CONSILIUM_PROVIDER_PREPARE',payload:{dispatchId,recipient,content,contentHash:hash}});
 if(!result?.ok)throw Error(result?.error||'Provider adapter could not prepare the message.');
 return {status:'prepared_for_manual_send',tabId:target.tabId,provider:recipient,detail:'Text inserted for review; click Send manually in the provider tab.'};
 }catch(error){throw Error('Dispatch outcome may be unknown; do not retry automatically. '+error.message);}finally{inFlightDispatches.delete(dispatchId);}
}
chrome.runtime.onMessageExternal.addListener((message,sender,sendResponse)=>{(async()=>{if(!isAllowedSender(sender))throw Error('Sender origin is not allowed.');if(!message||message.protocolVersion!==PROTOCOL_VERSION||!ALLOWED_TYPES.has(message.type))throw Error('Invalid protocol version or message type.');switch(message.type){case 'CONSILIUM_PING':return {ok:true,protocolVersion:1,status:'ready'};case 'CONSILIUM_GET_STATUS':return {ok:true,protocolVersion:1,status:await status()};case 'CONSILIUM_CONFIRM_DISPATCH':return {ok:true,protocolVersion:1,...await dispatch(message.payload)};case 'CONSILIUM_CANCEL_DISPATCH':return {ok:true,protocolVersion:1,status:'cancelled'};default:throw Error('Unsupported message type.');}})().then(sendResponse).catch(e=>sendResponse(responseError(e.message||'Unknown extension error.')));return true;});
chrome.runtime.onInstalled.addListener(()=>{chrome.storage.local.set({consiliumInstalledAt:new Date().toISOString(),consiliumProtocolVersion:PROTOCOL_VERSION});});
