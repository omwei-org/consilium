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
function renderActive(){if(!active)return;$('workspace').hidden=false;const recovery=active.pendingRound&&active.pendingRound.mode!=='manual_fallback'&&!['complete','abandoned'].includes(active.pendingRound.status);$('recovery-panel').hidden=!recovery;if(recovery){const ds=active.pendingRound.dispatches||[];const states=ds.map(d=>(d.provider||'provider')+': '+(d.status||'unknown')).join(' · ');$('recovery-summary').textContent='Round '+active.pendingRound.round+' · '+active.pendingRound.status+' · '+ds.length+' tracked dispatch(es)'+(states?' — '+states:'')+'. No dispatch will be retried automatically.';}$('session-title').textContent=active.title;$('intent-summary-text').textContent=active.intent;$('count').textContent=active.messages.length+' messages';const timeline=$('timeline');timeline.replaceChildren();for(const m of active.messages){const li=document.createElement('li');const title=document.createElement('strong');title.textContent=(m.sender||m.recipient||'Note')+' · ';const content=document.createElement('span');content.textContent=m.content;li.append(title,content);timeline.append(li);}const currentRound=Number(active.pendingRound?.round??active.round);const currentResponses=PROVIDERS.filter(p=>active.messages.some(m=>m.sender===p&&m.kind==='response'&&Number(m.round)===currentRound));const roundOpen=Boolean(active.pendingRound&&!['complete','abandoned'].includes(active.pendingRound.status));const dispatchStates=(active.pendingRound?.dispatches||[]).map(d=>d.status);let nextStep='Ready to prepare round '+(active.round+1)+'.';if(active.pendingRound?.status==='complete')nextStep='Both responses are saved. Add a moderator instruction and prepare the next round when ready.';else if(active.pendingRound?.status==='abandoned')nextStep='This round was closed manually. Inspect history before starting another round.';else if(active.pendingRound?.mode==='manual_fallback')nextStep='Manual round · '+currentResponses.length+' of 2 responses saved. Paste and save each provider response below.';else if(active.pendingRound&&dispatchStates.includes('unknown'))nextStep='Dispatch outcome unknown. Inspect provider tabs and reconcile before proceeding.';else if(active.pendingRound&&dispatchStates.includes('awaiting_extension_approval'))nextStep='Next: open the Consilium extension popup and approve each staged request. Then review the text in the provider tab and click Send yourself.';else if(active.pendingRound&&dispatchStates.includes('prepared_for_manual_send'))nextStep='Prompt prepared. Review it in the provider tab and click Send yourself, then save the response below.';else if(roundOpen)nextStep='Round in progress · '+currentResponses.length+' of 2 responses saved. Record the responses below; do not resend automatically.';$('round-status-text').textContent='Round '+(active.pendingRound?currentRound:active.round+1)+' · '+(active.pendingRound?.status==='complete'?'Both responses recorded':active.pendingRound?.status==='abandoned'?'Manually closed':currentResponses.length+' of 2 responses recorded')+'\n'+nextStep;for(const p of PROVIDERS){$('save-'+p).disabled=!roundOpen;const last=[...active.messages].reverse().find(m=>m.sender===p&&m.kind==='response');const current=[...active.messages].reverse().find(m=>m.sender===p&&m.kind==='response'&&Number(m.round)===currentRound);$(p+'-response').textContent=last?last.content:'No response captured yet.';if(current)$(p+'-state').textContent='Response saved for round '+currentRound;else if(active.pendingRound&&!['complete','abandoned'].includes(active.pendingRound.status))$(p+'-state').textContent='Waiting for response for round '+currentRound;else if(last)$(p+'-state').textContent='Latest response is from round '+(last.round??'unknown');else $(p+'-state').textContent='No response saved yet';}}
async function activate(id){active=sessions.find(s=>s.id===id);if(active)renderActive();}
async function createSession(intent){active={id:uid(),title:intent.trim().slice(0,64),intent:intent.trim(),createdAt:iso(),updatedAt:iso(),messages:[],round:0};sessions.unshift(active);await saveSession();renderActive();}
function buildPrompt(){return ConsiliumCore.buildPrompt(active.intent,active.messages,$('instruction').value);}
function confirmOne(provider,content){return new Promise(resolve=>{approvalResolve=resolve;$('recipient').textContent=provider==='chatgpt'?'ChatGPT':'Claude';$('approval-content').textContent=content;$('approval').showModal();});}
function closeApproval(result){if(!$('approval').open)return;$('approval').close();const r=approvalResolve;approvalResolve=null;if(r)r(result);}
function extensionId(){return localStorage.getItem('consilium.extensionId')||'';}
function validExtensionId(id){return /^[a-p]{32}$/.test(id);}
$('approval-form').addEventListener('submit',e=>{e.preventDefault();closeApproval(true);});
$('cancel-approval').addEventListener('click',async()=>{queue=[];closeApproval(false);const extId=extensionId();let failed=0;for(const item of stagedDispatches){try{const r=await chrome.runtime.sendMessage(extId,{protocolVersion:1,type:'CONSILIUM_CANCEL_DISPATCH',payload:{dispatchId:item.dispatchId}});if(!r?.ok)failed++;}catch{failed++;}}if(failed)toast('Round cancelled, but '+failed+' staged request(s) could not be confirmed cancelled. Check the extension popup before continuing.');else toast('Round cancelled; pending extension requests were removed.');});
$('intent-form').addEventListener('submit',async e=>{e.preventDefault();const intent=$('intent').value.trim();if(!intent)return;try{await createSession(intent);$('intent').value='';toast('Session created.');}catch(err){toast('Could not save session: '+err.message);}});
$('new-round').addEventListener('click',()=>{$('instruction').focus();});
$('close-round-manually').addEventListener('click',async()=>{if(!active?.pendingRound||['complete','abandoned'].includes(active.pendingRound.status))return;if(!confirm('Close this round as abandoned? First inspect both provider tabs and the extension popup. Consilium will not infer whether a message was sent.'))return;active.pendingRound.status='abandoned';active.pendingRound.closedManuallyAt=iso();active.pendingRound.updatedAt=iso();active.messages.push({id:uid(),round:active.pendingRound.round,sender:'system',kind:'round_resolution',content:'Moderator manually abandoned this round after inspecting provider state. Delivery outcomes were not inferred.',createdAt:iso(),status:'manually_abandoned'});await saveSession();renderActive();toast('Round closed manually. No messages were resent.');});
$('reconcile-round').addEventListener('click',async()=>{if(!active?.pendingRound){toast('No interrupted round to reconcile.');return;}const extId=extensionId();if(!validExtensionId(extId)){toast('Set a valid extension ID first.');return;}try{const r=await chrome.runtime.sendMessage(extId,{protocolVersion:1,type:'CONSILIUM_GET_STATUS'});if(!r?.ok)throw Error(r?.error||'Extension status unavailable.');for(const d of active.pendingRound.dispatches||[]){const outcome=ConsiliumCore.reconcileDispatch(d,r.status||{});d.status=outcome.status;d.reconcileDetail=outcome.reason||outcome.source||null;d.reconciledAt=iso();}active.pendingRound.lastReconciledAt=iso();active.pendingRound.extensionPendingCount=r.status?.pendingCount??null;active.pendingRound.updatedAt=iso();await saveSession();renderActive();const states=[...new Set((active.pendingRound.dispatches||[]).map(d=>d.status))].join(', ');toast('Reconciled without retrying. Dispatch states: '+(states||'none')+'. Prepared text is not proof of sending.');}catch(e){toast('Could not reconcile: '+e.message);}});

$('prepare-round').addEventListener('click',async()=>{
 if(!active){toast('Start or select a session first.');return;}
 if(active.pendingRound&&!['complete','abandoned'].includes(active.pendingRound.status)){toast('Resolve the current round first. Reconcile its dispatches and record both provider responses; nothing will be resent automatically.');return;}
 if(isDispatching){toast('A dispatch sequence is already running.');return;}
 const extId=extensionId();if(!validExtensionId(extId)){toast('Set a valid extension ID in Settings first.');$('settings-open').focus();return;}
 const moderatorInstruction=$('instruction').value.trim();
 let content;try{content=buildPrompt();}catch(err){toast(err.message||'Could not build prompt. Nothing was sent.');return;}if(content.length>MAX_CONTENT_CHARS){toast('Full context exceeds the supported size. Nothing was sent; export or start a separate session.');return;}
 isDispatching=true;$('prepare-round').disabled=true;
 const round=active.round+1;stagedDispatches=[];queue=PROVIDERS.map(provider=>({provider,content,round}));active.pendingRound={round,status:'preparing',startedAt:iso(),updatedAt:iso(),dispatches:[]};
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
   const dispatchRecord={dispatchId,provider:item.provider,round:item.round,status:'approval_confirmed',createdAt:iso()};active.pendingRound.dispatches.push(dispatchRecord);active.pendingRound.updatedAt=iso();await saveSession();
   const contentHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(item.content)))].map(b=>b.toString(16).padStart(2,'0')).join('');
   active.messages.push({id:uid(),round:item.round,sender:'moderator',recipient:item.provider,content:item.content,createdAt:iso(),status:'staged_for_extension_approval'});await saveSession();
   try{
    stagedDispatches.push({dispatchId,provider:item.provider,round:item.round});
    const result=await chrome.runtime.sendMessage(extId,{protocolVersion:1,type:'CONSILIUM_CONFIRM_DISPATCH',payload:{dispatchId,sessionId:active.id,roundId:String(item.round),recipient:item.provider,content:item.content,contentHash,attempt:1}});
    if(!result?.ok)throw new Error(result?.error||'Extension did not confirm dispatch.');
    dispatchRecord.status='awaiting_extension_approval';dispatchRecord.stagedAt=iso();active.pendingRound.updatedAt=iso();
    active.messages.push({id:uid(),round:item.round,sender:'system',recipient:item.provider,content:'Awaiting trusted approval in the Consilium Chrome Extension popup. After approval, review the text in the provider tab and click Send yourself.',createdAt:iso(),status:'awaiting_extension_approval'});
    toast(item.provider+' request staged. Open the Consilium toolbar popup to approve it.');
   }catch(err){
    dispatchRecord.status='unknown';dispatchRecord.error=err.message;active.pendingRound.status='interrupted';active.pendingRound.updatedAt=iso();
    active.messages.push({id:uid(),round:item.round,sender:'system',recipient:item.provider,content:'Dispatch failed or outcome is unknown: '+err.message+' Do not retry automatically.',createdAt:iso(),status:'unknown'});
    toast('Dispatch failed or outcome unknown. Check the provider tab before retrying.');queue=[];
   }
   await saveSession();renderActive();
  }
 }catch(err){queue=[];toast('Round stopped safely: '+err.message);}
 finally{queue=[];if(active?.pendingRound){if(active.pendingRound.status==='preparing')active.pendingRound.status='interrupted';else if(active.pendingRound.status!=='interrupted')active.pendingRound.status='awaiting_manual_responses';active.pendingRound.updatedAt=iso();await saveSession().catch(()=>{});renderActive();}stagedDispatches=[];isDispatching=false;$('prepare-round').disabled=false;}
});

let manualFallbackProvider=null;
async function openManualFallback(provider){
 if(!active){toast('Start or select a session first.');return;}
 let content;
 const current=active.pendingRound;
 if(current&&!['complete','abandoned'].includes(current.status)){
  if(current.mode!=='manual_fallback'){toast('Resolve the active extension round first. Do not bypass an unresolved dispatch.');return;}
  content=current.promptContent;
  if(typeof content!=='string'||!content){toast('The saved manual-round prompt is unavailable. Export the session and inspect its history before proceeding.');return;}
 }else{
  try{content=buildPrompt();}catch(err){toast(err.message||'Could not build prompt.');return;}
  if(content.length>MAX_CONTENT_CHARS){toast('Full context exceeds the supported size. Nothing was prepared; export or start a separate session.');return;}
  const round=active.round+1;
  const instruction=$('instruction').value.trim();
  active.round=round;
  if(instruction)active.messages.push({id:uid(),round,sender:'moderator',kind:'moderator_instruction',content:instruction,createdAt:iso(),status:'recorded'});
  active.pendingRound={round,status:'awaiting_manual_responses',mode:'manual_fallback',promptContent:content,startedAt:iso(),updatedAt:iso(),dispatches:[]};
  $('instruction').value='';
  try{await saveSession();}catch(err){toast('Could not save manual round: '+err.message);return;}
  renderActive();
 }
 manualFallbackProvider=provider;
 $('manual-recipient').textContent=provider==='chatgpt'?'ChatGPT':'Claude';
 $('manual-content').value=content;
 $('manual-fallback').showModal();
}
$('manual-chatgpt').addEventListener('click',()=>openManualFallback('chatgpt').catch(e=>toast('Could not prepare manual prompt: '+e.message)));
$('manual-claude').addEventListener('click',()=>openManualFallback('claude').catch(e=>toast('Could not prepare manual prompt: '+e.message)));
$('manual-select').addEventListener('click',()=>{$('manual-content').focus();$('manual-content').select();toast('Prompt selected. Copy it and paste it into '+(manualFallbackProvider==='chatgpt'?'ChatGPT':'Claude')+'.');});
$('manual-copy').addEventListener('click',async()=>{
 const content=$('manual-content').value;if(!content){toast('No prompt to copy.');return;}
 try{if(!navigator.clipboard||!navigator.clipboard.writeText)throw Error('Clipboard API unavailable');await navigator.clipboard.writeText(content);toast('Prompt copied for '+(manualFallbackProvider==='chatgpt'?'ChatGPT':'Claude')+'. Paste and send it manually.');}
 catch(error){$('manual-content').focus();$('manual-content').select();toast('Could not access clipboard. Prompt selected; copy it manually.');}
});
$('export').addEventListener('click',()=>{if(!active)return;const blob=new Blob([JSON.stringify(active,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='consilium-'+active.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('clear').addEventListener('click',async()=>{if(isDispatching){toast('Finish or cancel the current approval sequence first.');return;}if(!confirm('Delete all local Consilium sessions? This cannot be undone.'))return;try{await store('readwrite',s=>s.clear());sessions=[];active=null;$('workspace').hidden=true;renderSessions();toast('Local history cleared.');}catch(err){toast('Could not clear history: '+err.message);}});
$('settings-open').addEventListener('click',()=>{$('extension-id').value=extensionId();$('settings').showModal();});
$('settings-cancel').addEventListener('click',()=>$('settings').close());
$('settings-form').addEventListener('submit',e=>{e.preventDefault();const id=$('extension-id').value.trim();if(!validExtensionId(id)){toast('Enter a valid 32-character Chrome extension ID.');return;}localStorage.setItem('consilium.extensionId',id);$('settings').close();checkExtension();});
async function saveManualResponse(provider){if(!active){toast('Create or select a session first.');return;}const input=$('capture-'+provider);const content=input.value.trim();if(!content){toast('Paste a non-empty response first.');return;}if(content.length>30000){toast('Response exceeds the size limit.');return;}const round=String(active.round);if(ConsiliumCore.isDuplicateResponse(active.messages,provider,round,content)){toast('This response is already saved for the current round.');return;}active.messages.push({id:uid(),round:Number(round),sender:provider,kind:'response',content,createdAt:iso(),status:'captured_manually'});if(active.pendingRound&&Number(active.pendingRound.round)===Number(round)){const expected=PROVIDERS.every(p=>active.messages.some(m=>m.sender===p&&m.kind==='response'&&Number(m.round)===Number(round)));if(expected)active.pendingRound.status='complete';}await saveSession();renderActive();input.value='';toast(provider+' response saved locally.');}
$('save-chatgpt').addEventListener('click',()=>saveManualResponse('chatgpt').catch(e=>toast('Could not save response: '+e.message)));
$('save-claude').addEventListener('click',()=>saveManualResponse('claude').catch(e=>toast('Could not save response: '+e.message)));

async function checkExtension(){const id=extensionId();if(!id){$('connection').textContent='Extension not configured';return;}try{if(!globalThis.chrome?.runtime?.sendMessage)throw new Error('Chrome external messaging API unavailable');const r=await chrome.runtime.sendMessage(id,{protocolVersion:1,type:'CONSILIUM_PING'});$('connection').textContent=r?.ok?'Extension connected':'Extension unavailable';}catch{$('connection').textContent='Extension unavailable';}}
(async()=>{try{db=await openDB();await loadSessions();const last=sessions[0];if(last)await activate(last.id);await checkExtension();}catch(e){toast('Local database unavailable: '+e.message);}})();
