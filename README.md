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
- [ ] Verify text preparation separately on ChatGPT and Claude in a real Chrome session.
- [ ] Review extension approval trust boundaries and provider DOM behavior.

See [manual Chrome integration test](docs/manual-chrome-test.md).

## Status and safety

This is a prototype, not production-ready. The intended extension workflow is: the hosted page stages a recipient-specific prompt; the user opens the Consilium toolbar popup and approves the exact text; the extension attempts to insert it into the recognized composer in the already-open provider tab; the user reviews it and clicks the provider's Send button manually; after the model responds, the user pastes the response into Consilium and saves it.

Important limitations:

- **Consilium does not create a new ChatGPT or Claude conversation.** It targets one already-open tab for the selected provider and attempts to fill one uniquely recognized, visible composer. Open or create the intended conversation yourself before approving the dispatch.
- **Preparing text is not sending it.** The extension deliberately does not click Send. A successful preparation status is not proof that the provider accepted the text as its internal editor state or that a message was submitted.
- **Responses are not captured automatically.** The user must paste the complete provider response into the provider-specific field and save it. A UI message such as “Waiting for response” or “No response captured yet” means Consilium has not yet saved a response for that step; it does not establish whether the provider received or answered the prompt.
- **Live integration remains unverified and has shown inconsistent behavior.** In owner-reported testing, a ChatGPT prompt was inserted and its answer was manually saved, but text preparation had also failed in another attempt. In a later Claude peer-review attempt, no new Claude conversation or inserted text was observed. The available observations do not establish the root cause or whether the Claude request reached and passed extension approval.
- **Ambiguous delivery is not retried automatically.** If the extension reports an unknown outcome, inspect the provider tab(s) and resolve the attempt through the extension popup before staging or approving another request.
- If extension dispatch is unavailable, the moderator UI offers a recipient-specific manual fallback: review and copy the context-aware prompt, then paste and send it yourself.

Static checks and mocked tests do not prove that the live provider DOM/editor state, extension injection, manual Send, or full peer-review workflow works. Do not treat the project as production-ready until the live checklist is completed and results are recorded.

## License

Consilium is licensed under the Apache License 2.0. Third-party provider software, services, and model weights remain under their respective licenses and terms.
