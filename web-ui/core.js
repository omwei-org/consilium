'use strict';
(function(root){
 const MAX_CONTENT_CHARS=30000;
 function conversationContext(messages){return (messages||[]).filter(m=>m&&(m.kind==='response'||m.kind==='moderator_instruction'||m.sender==='chatgpt'||m.sender==='claude'||m.sender==='user')&&typeof m.content==='string').map(m=>'['+(m.sender||'moderator')+']\n'+m.content).join('\n\n');}
 function buildPrompt(intent,messages,instruction){const original=String(intent||'').trim();if(!original)throw new Error('Original intent is required.');const prior=conversationContext(messages);const note=String(instruction||'').trim();const prompt='You are participating in a moderated discussion. Respond independently and state assumptions and uncertainty. Do not assume you can see the other assistant unless its response is included below.\n\nORIGINAL INTENT\n'+original+'\n\nPRIOR CONTEXT\n'+(prior||'(No prior messages.)')+'\n\nMODERATOR INSTRUCTION FOR THIS ROUND\n'+(note||'Provide your best analysis of the original intent.');if(prompt.length>MAX_CONTENT_CHARS)throw new Error('Full context exceeds the supported size. Nothing was sent; export or start a separate session.');return prompt;}
 function buildPeerPrompt(intent,messages,provider){
  const original=String(intent||'').trim();if(!original)throw new Error('Original intent is required.');
  if(provider!=='chatgpt'&&provider!=='claude')throw new Error('Unsupported peer-review participant.');
  const prior=conversationContext(messages);
  const latestChatGPT=[...(messages||[])].reverse().find(m=>m&&m.sender==='chatgpt'&&m.kind==='response'&&typeof m.content==='string');
  const latestClaude=[...(messages||[])].reverse().find(m=>m&&m.sender==='claude'&&m.kind==='response'&&typeof m.content==='string');
  let role;
  if(provider==='chatgpt'&&!latestChatGPT) role='You are the primary author. Answer the original intent directly. State assumptions and uncertainty.';
  else if(provider==='claude'&&latestChatGPT) role='You are the peer reviewer of ChatGPT’s latest answer. Review that answer against the original intent and the prior discussion. Identify substantive errors, omissions, unsupported assumptions, uncertainty, and useful improvements. Do not write a parallel standalone answer. Be fair and specific; distinguish definite errors from possible concerns.';
  else if(provider==='claude') throw new Error('Claude peer review requires a saved ChatGPT response.');
  else if(provider==='chatgpt'&&latestClaude) role='You are the original author responding to Claude’s latest peer review. Address its specific points one by one. Acknowledge valid criticism, explain reasoned disagreement, and revise or clarify your answer where warranted. Do not blindly accept the review.';
  else if(provider==='chatgpt') role='You are the primary author. Answer the original intent directly. State assumptions and uncertainty.';
  const prompt='You are participating in an iterative, user-controlled peer-review discussion. Respond only in the role specified below.\n\nORIGINAL INTENT\n'+original+'\n\nPRIOR DISCUSSION\n'+(prior||'(No prior messages.)')+'\n\nYOUR ROLE\n'+role+'\n\nImportant: this is a sequential discussion, not a comparison of two independent answers. Do not claim to see context that is not included here.';
  if(prompt.length>MAX_CONTENT_CHARS)throw new Error('Full context exceeds the supported size. Nothing was prepared; export or start a separate session.');
  return prompt;
 }
 function isDuplicateResponse(messages,provider,round,content){return (messages||[]).some(m=>m&&m.sender===provider&&m.kind==='response'&&String(m.round)===String(round)&&m.content===content);}
 function reconcileDispatch(dispatch,status){
  const id=dispatch&&dispatch.dispatchId;
  if(!id)return {status:'outcome_unknown',reason:'missing_dispatch_id'};
  const previous=dispatch.status;
  const terminal=['cancelled_before_approval','rejected_before_approval'];
  if(terminal.includes(previous))return {status:previous,source:'local_terminal_state',preserved:true};
  const attempts=status&&status.dispatchAttempts||[];
  const attempt=attempts.find(x=>x.dispatchId===id);
  const pending=(status&&status.pendingDispatches||[]).find(x=>x.dispatchId===id);
  let observed;
  if(attempt){
   if(attempt.state==='cancelled_before_approval')observed={status:'cancelled_before_approval',source:'extension_attempt'};
   else if(attempt.state==='rejected_before_approval')observed={status:'rejected_before_approval',source:'extension_attempt'};
   else if(attempt.state==='prepared_for_manual_send')observed={status:'prepared_for_manual_send',source:'extension_attempt',tabId:attempt.tabId??null};
   else if(attempt.state==='preparing'||attempt.state==='outcome_unknown')observed={status:'outcome_unknown',source:'extension_attempt',reason:attempt.state};
   else if(attempt.state==='manually_reviewed')observed={status:'manually_reviewed_outcome_still_unknown',source:'extension_attempt',reason:'manual_review_does_not_prove_delivery'};
   else observed={status:'outcome_unknown',source:'extension_attempt',reason:'unrecognized_attempt_state'};
  }else if(pending)observed={status:'awaiting_extension_approval',source:'extension_pending'};
  else observed={status:'outcome_unknown',reason:'not_found_in_extension'};
  if(terminal.includes(observed.status))return observed;
  // A stale status snapshot must never roll a locally observed later state backwards.
  if(previous==='prepared_for_manual_send'&&!terminal.includes(observed.status))return {status:previous,source:'local_state_preserved',reason:'confirmed_preparation_is_not_rolled_back_by_nonterminal_snapshot',preserved:true};
  if(previous==='manually_reviewed_outcome_still_unknown'&&observed.status!=='cancelled_before_approval'&&observed.status!=='rejected_before_approval')return {status:previous,source:'local_state_preserved',reason:'manual_review_does_not_prove_delivery',preserved:true};
  if(previous==='outcome_unknown'&&observed.status==='awaiting_extension_approval')return {status:previous,source:'local_state_preserved',reason:'stale_status_cannot_resolve_unknown',preserved:true};
  return observed;
 }
 root.ConsiliumCore=Object.freeze({MAX_CONTENT_CHARS,conversationContext,buildPrompt,buildPeerPrompt,isDuplicateResponse,reconcileDispatch});
})(globalThis);
