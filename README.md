# Consilium

A personal browser-based moderator for a discussion between ChatGPT and Claude. The MVP uses a hosted UI and a local Chrome Extension; conversation content is not sent to a Consilium server and no model API is used.

## MVP scope
- Hosted moderator UI intended for `https://omwei.tech`.
- Browser integration through a Manifest V3 Chrome Extension.
- Sequential, explicit confirmation for each recipient.
- Local session and message history in IndexedDB.
- Original intent, moderator instructions, and captured responses are retained in future prompt context; repeated dispatch envelopes remain in local history/export but are excluded from prompts. Oversized prompts are not silently summarized.
- Ambiguous delivery is not retried automatically.
- No local bridge, server-side conversation database, team features, or autonomous rounds.

## Layout
- `web-ui/`: moderator panel, local persistence, extension messaging.
- `chrome-extension/`: extension service worker and conservative provider adapter.
- `docs/architecture.md`: trust boundaries, protocol, risks and acceptance plan.
- `scripts/check.mjs`: syntax and safety-oriented static checks.

## Run locally
Serve `web-ui/` over HTTP (do not use `file://`). Load `chrome-extension/` as an unpacked extension at `chrome://extensions`. Enter the installed extension ID in the UI settings. The manifest currently allows the production origins and localhost development origins.

## Status and safety
This is a prototype scaffold, not production-ready. The extension can prepare text in a recognized provider composer but deliberately does not click Send. Provider DOM selectors must be verified against the live sites. Responses can be pasted into provider-specific fields and stored locally. Automatic response capture and generation-completion detection are not implemented. A confirmation shown only in the hosted page is not a trusted boundary against a compromised page or XSS; production should use an extension-owned approval surface.