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
  const pending=r.pending||[];
  $('status').textContent=pending.length?pending.length+' request(s) awaiting your decision.':'No pending requests.';
  for(const p of pending){
   const card=el('article','request'),title=el('h2','',p.recipient==='chatgpt'?'ChatGPT':'Claude');
   const meta=el('p','meta','Session '+String(p.sessionId).slice(0,12)+' · Round '+p.roundId);
   const preview=el('pre','content',p.content);
   const warning=el('p','warning','This inserts text only. It does not send the message.');
   const actions=el('div','actions'),reject=el('button','secondary','Reject'),approve=el('button','primary','Approve and prepare');
   reject.addEventListener('click',async()=>{reject.disabled=approve.disabled=true;try{const x=await call('CONSILIUM_POPUP_REJECT',{dispatchId:p.dispatchId});if(!x?.ok)throw Error(x?.error||'Reject failed');await load();}catch(e){$('status').textContent=e.message;reject.disabled=approve.disabled=false;}});
   approve.addEventListener('click',async()=>{if(!confirm('Prepare this exact message for '+p.recipient+'? Review it before manually clicking Send.'))return;reject.disabled=approve.disabled=true;try{const x=await call('CONSILIUM_POPUP_APPROVE',{dispatchId:p.dispatchId});if(!x?.ok)throw Error(x?.error||'Approval failed');$('status').textContent='Prepared in '+p.recipient+'. Switch to that tab and review before clicking Send.';await load();}catch(e){$('status').textContent=e.message;reject.disabled=approve.disabled=false;}});
   actions.append(reject,approve);card.append(title,meta,preview,warning,actions);host.append(card);
  }
 }catch(e){$('status').textContent='Could not load requests: '+e.message;}
}
load();
