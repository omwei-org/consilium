# Consilium

A personal browser-based moderator for a discussion between ChatGPT and Claude. The MVP uses a hosted UI and a local Chrome Extension; conversation content is not sent to a Consilium server and no model API is used.

## MVP scope
- Hosted moderator UI at `https://omwei.tech` (canonical hostname and redirect behavior still need independent verification).
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
- `docs/manual-chrome-test.md`: live browser acceptance checklist.
- `scripts/check.mjs`: syntax and safety-oriented static checks.

## Run locally
Serve `web-ui/` over HTTP (do not use `file://`). Load `chrome-extension/` as an unpacked extension at `chrome://extensions`. Enter the installed extension ID in the UI settings. The manifest allows the production origins and localhost development origins.

## Hosting and deployment

The app is configured to publish the contents of `web-ui/` to GitHub Pages through `.github/workflows/deploy-pages.yml` on pushes to `main`. The workflow and static checks succeeded for the merge commit `5e38436525aeb0d2f8fb232e1ee8b693a1561241`. The UI has also been visually confirmed loading at `https://omwei.tech` by the project owner.

That confirms the page loads, but it does **not** establish that all live interactions work, that the `www` and apex hostnames redirect as intended, or that the full Chrome/provider integration passes. Those checks remain in `docs/manual-chrome-test.md`. The custom domain configured in `web-ui/CNAME` is `www.omwei.tech`; custom-workflow deployments ignore the CNAME file, so the GitHub Pages repository settings and DNS/TLS configuration are authoritative.

## Release readiness

The MVP scaffold has been merged into `main` and deployed. It remains a prototype, not production-ready.

- [x] Merge the MVP implementation into `main`.
- [x] Confirm the GitHub Pages deployment workflow succeeds.
- [x] Owner confirms the Consilium UI loads at `https://omwei.tech`.
- [ ] Verify the apex and `www` hostname behavior and HTTPS in a live browser.
- [ ] Complete the live Chrome checklist against the deployed origin and record browser/provider versions.
- [ ] Review extension approval trust boundaries and provider DOM behavior.

See [manual Chrome integration test](docs/manual-chrome-test.md).

## Status and safety
This is a prototype, not production-ready. The extension can prepare text in a recognized provider composer but deliberately does not click Send. Provider DOM selectors must be verified against the live sites. Responses can be pasted into provider-specific fields and stored locally. If extension dispatch is unavailable, the moderator UI offers a recipient-specific manual fallback: review and copy the context-aware prompt, then paste and send it yourself. Automatic response capture and generation-completion detection are not implemented. The hosted page only stages requests. Review the complete content and recipient in the Chrome toolbar extension popup and approve there; the provider Send button remains manual. The approval flow still requires security review and live Chrome testing.
