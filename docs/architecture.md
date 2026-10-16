# Consilium MVP Architecture

## Components
1. **Hosted UI** — intent entry, session timeline, moderator instruction, sequential approval and local history.
2. **Pure context core (`web-ui/core.js`)** — deterministic prompt composition, substantive-context filtering, duplicate-response checks and a hard size limit; tested without browser APIs.
3. **Extension service worker** — checks sender origin and protocol, validates bounded payloads, identifies one unambiguous provider tab and records dispatch IDs as consumed before attempting delivery.
4. **Provider content adapter** — validates provider identity and composer uniqueness, then prepares text for manual review.
5. **Local storage** — IndexedDB on the hosted UI origin for sessions and messages; extension storage for consumed dispatch IDs and extension metadata.

No server-side message store and no model API are part of the MVP.

## Trust boundaries
- The hosted UI is an orchestration client, not a trusted executor.
- The extension only accepts exact production origins plus HTTP loopback development origins.
- No arbitrary selectors, URLs or scripts are accepted from the page.
- AI output must be rendered as text, never injected as HTML.
- Each outbound message requires a fresh per-recipient confirmation in the current UI.
- Ambiguous delivery is an unknown state and must not trigger blind retry.
- Page-only confirmation is not independently trusted against a compromised page. Production needs an extension-owned approval surface.

## Protocol
Version 1 external messages: `CONSILIUM_PING`, `CONSILIUM_GET_STATUS`, `CONSILIUM_CONFIRM_DISPATCH`, `CONSILIUM_CANCEL_DISPATCH`. The extension validates origin, message type, recipient, content length and SHA-256 content hash. Dispatch IDs are single-use. The content script never clicks Send.

## Context policy
Keep original intent, prior moderator instructions and manually captured assistant responses in local history. The context-composition helpers have behavioral regression tests for ordering, filtering, duplicate detection, empty intent and oversized context. Full dispatch records remain available in history/export but are excluded from future prompt context to avoid recursively repeating the assembled prompt. Do not silently summarize or drop substantive context. If the prompt is too large, pause for an explicit moderator decision. Response capture is manual; automatic capture and reliable generation-completion detection are not implemented.

## Acceptance checklist
- [x] Create and export local sessions.
- [x] Separate sequential approval per recipient.
- [x] Reject missing or multiple provider tabs.
- [x] Do not automatically retry an ambiguous dispatch.
- [x] Keep Send action manual.
- [ ] Verify provider selectors against current ChatGPT and Claude UI.
- [x] Allow moderator to paste and save responses locally for later rounds.\n- [ ] Automatically capture complete responses and reliably detect generation completion.
- [ ] Restore in-progress round state after refresh/service-worker restart.
- [ ] Move approval to extension-owned trusted UI before production.
- [ ] Review current provider terms and Chrome Web Store policy before release.