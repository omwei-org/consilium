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

## Dispatch recovery ledger

The extension persists a bounded ledger of dispatch attempts in `chrome.storage.local`, without duplicating message bodies. A consumed request is recorded as `preparing` before the provider adapter is called, then `prepared_for_manual_send` on a confirmed adapter response or `outcome_unknown` on an ambiguous failure. A worker restart that leaves an attempt in `preparing` is surfaced as unresolved. While any attempt is `preparing` or `outcome_unknown`, the background handler blocks new staging and approvals. The trusted popup can clear this block only after the operator explicitly confirms manual inspection of the relevant provider tab(s); this records `manually_reviewed`, not proof that a message was or was not sent. Dispatch IDs remain consumed and are never retried automatically.

## Terminal dispatch outcomes

A request explicitly cancelled by the hosted UI or rejected in the extension popup before approval must be recorded as `cancelled_before_approval` or `rejected_before_approval` in the extension attempt ledger. These are known terminal outcomes, not missing/unknown dispatches. Reconciliation should expose them as terminal states; only a missing ledger record for a previously staged dispatch remains unknown. Record the terminal state and remove the pending item in one storage update so a refresh does not misclassify an intentional cancellation.

## Cross-store reconciliation

The hosted UI's IndexedDB round ledger and the extension's `chrome.storage.local` ledger are independent stores. `CONSILIUM_GET_STATUS` therefore exposes minimal dispatch-attempt metadata (dispatch ID, state, session/round IDs, recipient, tab ID and update time) alongside pending requests. The hosted UI reconciles each known dispatch deterministically: extension-pending means `awaiting_extension_approval`; `prepared_for_manual_send` means only that text preparation was acknowledged; `preparing` or `outcome_unknown` remains unknown; a manually reviewed attempt is still not evidence of delivery; and a missing extension record is treated as unknown. Reconciliation never retries or marks a request sent. The hosted round remains active until both responses are manually captured or a moderator explicitly abandons it after provider-tab inspection.

## Live-browser validation

Follow [the manual Chrome integration checklist](manual-chrome-test.md). It is an unexecuted test plan, not evidence of a live-browser pass.

## Approval ordering

Oldest-first approval is enforced both by the popup UI and by the extension background handler, so a direct or stale popup message cannot bypass ordering. The behavioral suite verifies that an out-of-order approval is refused and the next request can proceed only after the oldest is resolved.

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
- [x] Persist extension dispatch attempt outcomes and block new staging while an attempt is unresolved (mocked worker-restart tests).
- [x] Allow explicit moderator abandonment of an interrupted round after manual provider-tab review; record the decision locally.
- [ ] End-to-end test recovery across refresh and service-worker restart in Chrome; simulated protocol tests do not establish browser compatibility.
- [x] Implement extension-owned approval popup prototype; hosted page can only stage requests.
- [ ] Security-review popup sender validation and test approval behavior in Chrome.
- [ ] Review current provider terms and Chrome Web Store policy before release.