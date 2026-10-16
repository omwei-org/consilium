'use strict';
const $ = (id) => document.getElementById(id);
const PROVIDERS = ['chatgpt', 'claude'];
const DB_NAME = 'consilium-local';
const MAX_CONTENT_CHARS = 30000;
let db, sessions = [], active = null, queue = [], approvalResolve = null, isDispatching = false, stagedDispatches = [];
const uid = () => crypto.randomUUID();
const iso = () => new Date().toISOString();
function toast(text) { const el=$('toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),3500); }
function openDB() { return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,1); req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('sessions'))d.createObjectStore('sessions',{keyPath:'id'});}; req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); }); }
function store(mode, fn) { return new Promise((resolve,reject)=>{const tx=db.transaction('sessions',mode);fn(tx.objectStore('sessions'));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));}); }
async function saveSession() { if(!active)return;active.updatedAt=iso();await store('readwrite',s=>s.put(active));renderSessions(); }
async function loadSessions() { sessions=await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readonly');const req=tx.objectStore('sessions').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});sessions.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));renderSessions(); }
function renderSessions(){const el=$('sessions');el.replaceChildren();if(!sessions.length){el.textContent='No saved sessions yet.';return;}for(const s of sessions){const b=document.createElement('button');b.className='session-button';b.textContent=s.title||'Untitled session';const date=document.createElement('span');date.textContent=new Date(s.updatedAt).toLocaleString();b.append(' ',date);b.addEventListener('click',()=>activate(s.id));el.append(b);}}
function renderActive(){if(!active)return;$('workspace').hidden=false;$('session-title').textContent=active.title;$('intent-summary-text').textContent=active.intent;$('count').textContent=active.messages.length+' messages';const timeline=$('timeline');timeline.replaceChildren();for(const m of active.messages){const li=document.createElement('li');const title=document.createElement('strong');title.textContent=(m.sender||m.recipient||'Note')+' · ';const content=document.createElement('span');content.textContent=m.content;li.append(title,content);timeline.append(li);}for(const p of PROVIDERS){const last=[...active.messages].reverse().find(m=>m.sender===p);$(p+'-response').textContent=last?last.content:'No response captured yet.';$(p+'-state').textContent=last?'Response captured locally':'Waiting for a manual response';}}
async function activate(id){active=sessions.find(s=>s.id===id);if(active)renderActive();}
async function createSession(intent){active={id:uid(),title:intent.trim().slice(0,64),intent:intent.trim(),createdAt:iso(),updatedAt:iso(),messages:[],round:0};sessions.unshift(active);await saveSession();renderActive();}
function buildPrompt(){return ConsiliumCore.buildPrompt(active.intent,active.messages,$('instruction').value);}
function confirmOne(provider,content){return new Promise(resolve=>{approvalResolve=resolve;$('recipient').textContent=provider==='chatgpt'?'ChatGPT':'Claude';$('approval-content').textContent=content;$('approval').showModal();});}
function closeApproval(result){if(!$('approval').open)return;$('approval').close();const r=approvalResolve;approvalResolve=null;if(r)r(result);}
function extensionId(){return localStorage.getItem('consilium.extensionId')||'';}
function validExtensionId(id){return /^[a-p]{32}$/.test(id);}
$('approval-form').addEventListener('submit',e=>{e.preventDefault();closeApproval(true);});
$('cancel-approval').addEventListener('click',()=>{queue=[];closeApproval(false);});
$('intent-form').addEventListener('submit',async e=>{e.preventDefault();const intent=$('intent').value.trim();if(!intent)return;try{await createSession(intent);$('intent').value='';toast('Session created.');}catch(err){toast('Could not save session: '+err.message);}});
$('new-round').addEventListener('click',()=>{$('instruction').focus();});
$('prepare-round').addEventListener('click',async()=>{
 if(!active){toast('Start or select a session first.');return;}
 if(isDispatching){toast('A dispatch sequence is already running.');return;}
 const extId=extensionId();if(!validExtensionId(extId)){toast('Set a valid extension ID in Settings first.');$('settings-open').focus();return;}
 const moderatorInstruction=$('instruction').value.trim();
 let content;try{content=buildPrompt();}catch(err){toast(err.message||'Could not build prompt. Nothing was sent.');return;}if(content.length>MAX_CONTENT_CHARS){toast('Full context exceeds the supported size. Nothing was sent; export or start a separate session.');return;}
 isDispatching=true;$('prepare-round').disabled=true;
 const round=active.round+1;stagedDispatches=[];queue=PROVIDERS.map(provider=>({provider,content,round}));
 try{
  active.round=round;
  if(moderatorInstruction)active.messages.push({id:uid(),round,sender:'moderator',kind:'moderator_instruction',content:moderatorInstruction,createdAt:iso(),status:'recorded'});
  await saveSession();
  $('instruction').value='';
  while(queue.length){
   const item=queue.shift();
   const approved=await confirmOne(item.provider,item.content);
   if(!approved){queue=[];toast('Remaining dispatches cancelled.');break;}
   const dispatchId=uid();
   const contentHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(item.content)))].map(b=>b.toString(16).padStart(2,'0')).join('');
   active.messages.push({id:uid(),round:item.round,sender:'moderator',recipient:item.provider,content:item.content,createdAt:iso(),status:'staged_for_extension_approval'});await saveSession();
   try{
    stagedDispatches.push({dispatchId,provider:item.provider,round:item.round});
    const result=await chrome.runtime.sendMessage(extId,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{dispatchId,sessionId:active.id,roundId:String(item.round),recipient:item.provider,content:item.content,contentHash,attempt:1}});
    if(!result?.ok)throw new Error(result?.error||'Extension did not confirm dispatch.');
    active.messages.push({id:uid(),round:item.round,sender:'system',recipient:item.provider,content:'Awaiting trusted approval in the Consilium Chrome Extension popup. After approval, review the text in the provider tab and click Send yourself.',createdAt:iso(),status:'awaiting_extension_approval'});
    toast(item.provider+' request staged. Open the Consilium toolbar popup to approve it.');
   }catch(err){
    active.messages.push({id:uid(),round:item.round,sender:'system',recipient:item.provider,content:'Dispatch failed or outcome is unknown: '+err.message+' Do not retry automatically.',createdAt:iso(),status:'unknown'});
    toast('Dispatch failed or outcome unknown. Check the provider tab before retrying.');queue=[];
   }
   await saveSession();renderActive();
  }
 }catch(err){queue=[];toast('Round stopped safely: '+err.message);}
 finally{queue=[];stagedDispatches=[];isDispatching=false;$('prepare-round').disabled=false;}
});
$('export').addEventListener('click',()=>{if(!active)return;const blob=new Blob([JSON.stringify(active,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='consilium-'+active.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('clear').addEventListener('click',async()=>{if(isDispatching){toast('Finish or cancel the current approval sequence first.');return;}if(!confirm('Delete all local Consilium sessions? This cannot be undone.'))return;try{await store('readwrite',s=>s.clear());sessions=[];active=null;$('workspace').hidden=true;renderSessions();toast('Local history cleared.');}catch(err){toast('Could not clear history: '+err.message);}});
$('settings-open').addEventListener('click',()=>{$('extension-id').value=extensionId();$('settings').showModal();});
$('settings-cancel').addEventListener('click',()=>$('settings').close());
$('settings-form').addEventListener('submit',e=>{e.preventDefault();const id=$('extension-id').value.trim();if(!validExtensionId(id)){toast('Enter a valid 32-character Chrome extension ID.');return;}localStorage.setItem('consilium.extensionId',id);$('settings').close();checkExtension();});
async function saveManualResponse(provider){if(!active){toast('Create or select a session first.');return;}const input=$('capture-'+provider);const content=input.value.trim();if(!content){toast('Paste a non-empty response first.');return;}if(content.length>30000){toast('Response exceeds the size limit.');return;}const round=String(active.round);if(ConsiliumCore.isDuplicateResponse(active.messages,provider,round,content)){toast('This response is already saved for the current round.');return;}active.messages.push({id:uid(),round:Number(round),sender:provider,kind:'response',content,createdAt:iso(),status:'captured_manually'});await saveSession();renderActive();input.value='';toast(provider+' response saved locally.');}
$('save-chatgpt').addEventListener('click',()=>saveManualResponse('chatgpt').catch(e=>toast('Could not save response: '+e.message)));
$('save-claude').addEventListener('click',()=>saveManualResponse('claude').catch(e=>toast('Could not save response: '+e.message)));

async function checkExtension(){const id=extensionId();if(!id){$('connection').textContent='Extension not configured';return;}try{if(!globalThis.chrome?.runtime?.sendMessage)throw new Error('Chrome external messaging API unavailable');const r=await chrome.runtime.sendMessage(id,{protocolVersion:1,type:'CONSILIUM_PING'});$('connection').textContent=r?.ok?'Extension connected':'Extension unavailable';}catch{$('connection').textContent='Extension unavailable';}}
(async()=>{try{db=await openDB();await loadSessions();const last=sessions[0];if(last)await activate(last.id);await checkExtension();}catch(e){toast('Local database unavailable: '+e.message);}})();
