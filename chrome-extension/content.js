'use strict';

const PROTOCOL_VERSION = 1;
function providerFromLocation() {
  const host = location.hostname;
  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
  return null;
}
function findComposer(provider) {
  // These selectors are intentionally conservative and need verification against
  // current provider DOMs. If no unique editable element is found, fail closed.
  const selectors = provider === 'chatgpt'
    ? ['#prompt-textarea', 'textarea[data-testid="prompt-textarea"]', '[contenteditable="true"][data-placeholder]']
    : ['div[contenteditable="true"][data-placeholder]', 'div[contenteditable="true"][role="textbox"]', 'textarea'];
  const candidates = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!element.isConnected || element.getAttribute('aria-hidden') === 'true') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && !element.hasAttribute('disabled')) candidates.push(element);
    }
    if (candidates.length) break;
  }
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}
function setEditableText(element, text) {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    if (!setter) throw new Error('Could not set text in the detected input.');
    setter.call(element, text);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } else if (element.isContentEditable) {
    element.replaceChildren(document.createTextNode(text));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } else throw new Error('Detected element is not editable.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (sender.id !== chrome.runtime.id || !message || message.protocolVersion !== PROTOCOL_VERSION || message.type !== 'CONSILIUM_PROVIDER_PREPARE') {
      sendResponse({ ok: false, error: 'Invalid internal extension message.' }); return;
    }
    const provider = providerFromLocation();
    const payload = message.payload;
    if (!provider || provider !== payload?.recipient) { sendResponse({ ok: false, error: 'Provider identity mismatch.' }); return; }
    if (typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > 30000) { sendResponse({ ok: false, error: 'Invalid message content.' }); return; }
    const composer = findComposer(provider);
    if (!composer) { sendResponse({ ok: false, error: 'Could not identify exactly one supported message composer. No action taken.' }); return; }
    setEditableText(composer, payload.content);
    sendResponse({ ok: true, status: 'prepared_for_manual_send', provider, detail: 'Message entered into composer. Review and click Send manually.' });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || 'Provider adapter failed.' });
  }
  return true;
});