'use strict';
const VERSION=1;
const $=id=>document.getElementById(id);
function call(type,extra={}){return chrome.runtime.sendMessage({protocolVersion:VERSION,type,...extra});}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
async function load(){
 const host=$('requests');host.replaceChildren();
 try{
  const r=await call('CONSILIUM_POPUP_LIST_PENDING');
  if(!r?.ok)throw Error(r?.error||'Could not read pending requests.');
  const uncertain=(r.unresolvedAttempts||[]);
  for(const a of uncertain){const card=el('article','request unresolved'),title=el('h2','','Outcome unknown — '+(a.recipient==='chatgpt'?'ChatGPT':'Claude')),meta=el('p','meta','Session '+String(a.sessionId||'').slice(0,12)+' · Round '+String(a.roundId||'')),warning=el('p','warning','This request was consumed before preparation completed. Inspect the provider tab manually. Do not retry it automatically.'),reviewed=el('button','secondary','I inspected the provider tab(s)');reviewed.addEventListener('click',async()=>{if(!confirm('Confirm you manually inspected the relevant provider tab(s) and understand Consilium cannot infer whether the text was inserted or sent?'))return;reviewed.disabled=true;try{const x=await call('CONSILIUM_POPUP_RESOLVE_UNKNOWN',{dispatchId:a.dispatchId,confirmation:'inspected_provider_tabs'});if(!x?.ok)throw Error(x?.error||'Could not record manual review');await load();}catch(e){$('status').textContent=e.message;reviewed.disabled=false;}});card.append(title,meta,warning,reviewed);host.append(card);}
  const pending=(r.pending||[]).sort((a,b)=>String(a.stagedAt).localeCompare(String(b.stagedAt)));
  const hasUnknown=uncertain.length>0;
  const firstId=pending[0]?.dispatchId;
  $('status').textContent=uncertain.length?uncertain.length+' request(s) have an unknown outcome. Inspect provider tabs before doing anything else.':pending.length?pending.length+' request(s) awaiting your decision. Resolve the oldest request first.':'No pending requests.';
  for(const p of pending){
   const card=el('article','request'),title=el('h2','',p.recipient==='chatgpt'?'ChatGPT':'Claude');
   const meta=el('p','meta','Session '+String(p.sessionId).slice(0,12)+' · Round '+p.roundId);
   const preview=el('pre','content',p.content);
   const warning=el('p','warning','This inserts text only. It does not send the message.');
   const actions=el('div','actions'),reject=el('button','secondary','Reject'),approve=el('button','primary','Approve and prepare');
   const isFirst=p.dispatchId===firstId;reject.disabled=approve.disabled=!isFirst||hasUnknown;if(!isFirst)card.setAttribute('aria-label','Waiting for earlier request to be resolved');
   reject.addEventListener('click',async()=>{reject.disabled=approve.disabled=true;try{const x=await call('CONSILIUM_POPUP_REJECT',{dispatchId:p.dispatchId});if(!x?.ok)throw Error(x?.error||'Reject failed');await load();if($('requests').children.length)$('status').textContent='Request resolved. Review the next request below before proceeding.';else $('status').textContent='Request rejected. No pending requests remain.';}catch(e){$('status').textContent=e.message;reject.disabled=approve.disabled=false;}});
   approve.addEventListener('click',async()=>{if(!confirm('Prepare this exact message for '+p.recipient+'? Review it before manually clicking Send.'))return;reject.disabled=approve.disabled=true;try{const x=await call('CONSILIUM_POPUP_APPROVE',{dispatchId:p.dispatchId});if(!x?.ok)throw Error(x?.error||'Approval failed');await load();if($('requests').children.length)$('status').textContent='Approved and prepared in '+p.recipient+'. Resolve the next request below when ready.';else $('status').textContent='Approved and prepared in '+p.recipient+'. Switch to that tab and review before clicking Send.';}catch(e){$('status').textContent=e.message;reject.disabled=approve.disabled=false;}});
   actions.append(reject,approve);card.append(title,meta,preview,warning,actions);host.append(card);
  }
 }catch(e){$('status').textContent='Could not load requests: '+e.message;}
}
load();
