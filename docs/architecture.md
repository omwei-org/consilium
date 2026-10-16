# Consilium MVP Architecture

## Components
1. **Hosted UI** — intent entry, session timeline, moderator instruction, sequential approval and local history.
2. **Pure context core (`web-ui/core.js`)** — deterministic prompt composition, substantive-context filtering, duplicate-response checks and a hard size limit; tested without browser APIs.
3. **Extension-owned approval popup (`chrome-extension/popup.html`)** — displays the complete staged message and recipient, allows explicit approve/reject, and resolves requests oldest-first. The page cannot invoke the popup's internal approval commands.
4. **Extension service worker** — checks sender origin and protocol, stages bounded payloads from the hosted UI, then revalidates content hash and provider tab after popup approval before delivery.
5. **Provider content adapter** — validates provider identity and composer uniqueness, then prepares text for manual review.
6. **Local storage** — IndexedDB on the hosted UI origin for sessions and messages; extension storage for consumed dispatch IDs and extension metadata.

No server-side message store and no model API are part of the MVP.

## Trust boundaries
- The hosted UI is an orchestration client, not a trusted executor.
- The extension only accepts exact production origins plus HTTP loopback development origins.
- No arbitrary selectors, URLs or scripts are accepted from the page.
- AI output must be rendered as text, never injected as HTML.
- Each outbound message requires a fresh per-recipient confirmation in the current UI.
- Ambiguous delivery is an unknown state and must not trigger blind retry.
- The hosted page can only stage requests; trusted approval is performed in the extension-owned popup, whose internal messages are restricted to its exact extension URL.
- The popup shows the complete message and recipient. Approval only inserts text; the provider Send button remains manual.

## Protocol
Version 1 external messages: `CONSILIUM_PING`, `CONSILIUM_GET_STATUS`, `CONSILIUM_CONFIRM_DISPATCH`, `CONSILIUM_CANCEL_DISPATCH`. `CONSILIUM_CONFIRM_DISPATCH` only stages a pending request. Only the extension-owned popup can invoke the internal approve/reject actions. Approval rechecks the content hash, dispatch ID, and unique provider tab; dispatch IDs are single-use. The content script never clicks Send.

## Context policy
Keep original intent, prior moderator instructions and manually captured assistant responses in local history. The context-composition helpers have behavioral regression tests for ordering, filtering, duplicate detection, empty intent and oversized context. Full dispatch records remain available in history/export but are excluded from future prompt context to avoid recursively repeating the assembled prompt. Do not silently summarize or drop substantive context. If the prompt is too large, pause for an explicit moderator decision. Response capture is manual; automatic capture and reliable generation-completion detection are not implemented.

## Test coverage boundary

The content adapter has mock-DOM behavioral tests for exact text insertion, preservation of an existing draft, ambiguous composers and recipient mismatch; these do not validate current provider DOM selectors.

## Acceptance checklist
- [x] Create and export local sessions.
- [x] Separate sequential approval per recipient.
- [x] Reject missing or multiple provider tabs (behavioral mock tests).
- [x] Do not automatically retry an ambiguous dispatch.
- [x] Keep Send action manual.
- [ ] Verify provider selectors against current ChatGPT and Claude UI in a real Chrome session.
- [x] Allow moderator to paste and save responses locally for later rounds.\n- [ ] Automatically capture complete responses and reliably detect generation completion.
- [x] Persist round state and reconcile extension-pending dispatches after page refresh without automatic retries.
- [x] Allow explicit moderator abandonment of an interrupted round after manual provider-tab review; record the decision locally.
- [ ] End-to-end test recovery across refresh and service-worker restart in Chrome; simulated protocol tests do not establish browser compatibility.
- [x] Implement extension-owned approval popup prototype; hosted page can only stage requests.
- [ ] Security-review popup sender validation and test approval behavior in Chrome.
- [ ] Review current provider terms and Chrome Web Store policy before release.