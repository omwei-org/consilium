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

## Release readiness

The MVP implementation currently lives on the `feat/mvp-scaffold` pull-request branch. The default `main` branch has not yet received this implementation, and a green static-check workflow is not evidence that the hosted site serves this branch. Before calling the app deployed, verify the actual hosting source/release and run the live Chrome checklist below.

Release gates:
- [ ] Confirm the hosting provider, deployment source branch/path, and rollback method.
- [ ] Verify the deployed page serves the expected Consilium build and all same-origin assets.
- [ ] Complete the live Chrome checklist against the deployed origin and record browser/provider versions.
- [ ] Review extension approval trust boundaries and provider DOM behavior.
- [ ] Merge only after the above gates are satisfied.

See [manual Chrome integration test](docs/manual-chrome-test.md).

## Status and safety
This is a prototype scaffold, not production-ready. The extension can prepare text in a recognized provider composer but deliberately does not click Send. Provider DOM selectors must be verified against the live sites. Responses can be pasted into provider-specific fields and stored locally. If extension dispatch is unavailable, the moderator UI also offers a recipient-specific manual fallback: review and copy the same context-aware prompt, then paste and send it yourself. Automatic response capture and generation-completion detection are not implemented. The hosted page only stages requests. Review the complete content and recipient in the Chrome toolbar extension popup and approve there; the provider Send button remains manual. This approval flow is a prototype and still requires security review and live Chrome testing.