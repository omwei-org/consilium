# Consilium — manual Chrome integration test

Status: **not yet executed against live provider UIs**. This checklist is the acceptance record for a human running the unpacked extension in Chrome. Mock-DOM and mocked-Chrome tests do not count as live integration evidence.

## Test setup

- [ ] Use a dedicated Chrome profile with no sensitive conversations open.
- [ ] Use only a harmless test prompt; do not put credentials, personal data, or confidential material into the test.
- [ ] Serve `web-ui/` from an allowed origin (`http://localhost` or `http://127.0.0.1` for local testing). Do not open `index.html` using `file://`.
- [ ] Open `chrome://extensions`, enable Developer mode, and load `chrome-extension/` as an unpacked extension.
- [ ] Copy the extension ID into Consilium Settings.
- [ ] Open exactly one ChatGPT tab at `https://chatgpt.com/` and exactly one Claude tab at `https://claude.ai/`.
- [ ] Record Chrome version, OS, extension version, test date, and the hosted UI origin below.

Do not proceed if Chrome reports extension errors or if the extension ID/origin is not the expected one.

## Test cases

For each case record **PASS**, **FAIL**, or **BLOCKED**, and attach a redacted screenshot or console error where useful. Never include private prompt/response contents in an issue report.

### A. Connectivity and origin

- [ ] A1 — Consilium reports the extension connected when the correct ID is configured.
- [ ] A2 — A deliberately invalid extension ID produces a clear error and does not claim the extension is connected.
- [ ] A3 — With the extension popup open, it shows no pending requests when none have been staged.
- [ ] A4 — From an unapproved web origin, external messages are rejected (use the automated protocol test for this; do not install a test page on an untrusted production origin).

### B. Popup approval and sequencing

- [ ] B1 — Stage a harmless prompt for ChatGPT. It appears in the extension toolbar popup with the correct recipient and complete text.
- [ ] B2 — Close the popup without approving. No text is inserted into ChatGPT.
- [ ] B3 — Reopen the popup and reject the request. It disappears from pending requests and no text is inserted.
- [ ] B4 — Stage a new harmless prompt and approve it in the extension popup. Only the exact reviewed text is inserted; the provider Send button is not clicked by the extension.
- [ ] B5 — Verify that the prompt remains unsent until the human clicks Send in the provider tab.
- [ ] B6 — Repeat B1–B5 with Claude.
- [ ] B7 — Stage one request for each provider. Confirm the popup requires oldest-first resolution and that the second request cannot be approved before the first is resolved.
- [ ] B8 — Verify the provider tab and recipient match before manually sending.

### C. Draft and ambiguity safety

- [ ] C1 — Type a harmless unsent draft into a provider composer. Attempt approval. The extension must refuse to overwrite the draft, and the draft must remain unchanged.
- [ ] C2 — Open a second tab for the same provider and attempt approval. It must fail closed with a clear multiple-tabs error.
- [ ] C3 — Close the only matching provider tab and attempt approval. It must fail closed with a no-tab error.
- [ ] C4 — Restore one provider tab and inspect pending state. Failed preflight must not silently send or automatically retry anything.
- [ ] C5 — If insertion fails or the outcome is uncertain, inspect the provider tab manually before taking any further action.

### D. Persistence and recovery

- [ ] D1 — Create a session and save a manual response. Refresh the hosted UI; the session and response should remain in local history.
- [ ] D2 — Stage a request, then refresh the hosted UI before approving. Reconcile state; no request should be resent automatically.
- [ ] D3 — With a pending request, close and reopen the extension popup. The pending request should remain visible.
- [ ] D4 — With a pending request, use the extension reload control in `chrome://extensions`. Reopen the popup and verify that the request remains visible in extension storage. Do not approve it twice.
- [ ] D5 — Simulate an interrupted round and use reconciliation. A missing request must be shown as outcome-unknown, not assumed sent or failed.
- [ ] D6 — Manually inspect both provider tabs before using “Close round after manual review”. Verify that the local history records the explicit abandonment.
- [ ] D7 — Verify the next round is blocked while an unresolved round remains active and becomes available after explicit completion/abandonment.

### E. Context and export

- [ ] E1 — Save one response from each provider and a moderator instruction. Verify that the next prepared prompt includes original intent, substantive prior responses, and relevant moderator instructions.
- [ ] E2 — Verify dispatch-envelope/system records are not recursively embedded in the next prompt.
- [ ] E3 — Verify an oversized prompt is refused with a clear error; context is not silently summarized or truncated.
- [ ] E4 — Export a session and verify that the file contains the expected history. Treat the export as sensitive local data.

### F. Manual fallback without extension dispatch

- [ ] F1 — Start a harmless test session and leave the extension ID unconfigured or use the UI without extension connectivity. Choose “Prepare manually for ChatGPT”; verify the dialog shows the complete prompt with the original intent and moderator instruction.
- [ ] F2 — Copy the prompt and paste it into ChatGPT yourself. Verify Consilium does not open a provider tab or click Send.
- [ ] F3 — Save ChatGPT's response using the manual response field. Verify the session stays on the same active manual round and the round is not marked complete after only one response.
- [ ] F4 — Refresh Consilium, select the same session, and choose “Prepare manually for Claude”. Verify the prompt is byte-for-byte identical to the saved prompt for this round, even though the first response is now in history.
- [ ] F5 — Paste and send the prompt to Claude yourself, save Claude's response, and verify the round becomes complete only after both provider responses are recorded for that round.
- [ ] F6 — Start another manual round with a moderator instruction. Verify the instruction appears in the prompt and is recorded once in local history; verify the next round includes the prior round's substantive responses and instruction.
- [ ] F7 — Start an extension-managed round and leave it unresolved. Attempt manual fallback; it must refuse to bypass the unresolved extension dispatch.
- [ ] F8 — Test clipboard denial/unavailability. The prompt should remain selectable for manual copying, with no claim that it was copied.

## Result record

- Date/time and timezone:
- Tester:
- OS and version:
- Chrome version:
- Extension version:
- Hosted UI origin:
- ChatGPT test result (A–E):
- Claude test result (A–E):
- Failures / console errors (redacted):
- Evidence filenames (redacted):
- Manual fallback result (F):
- Overall: **NOT RUN / PASS / FAIL / BLOCKED**
- Follow-up issue links:

## Stop conditions

Stop testing and do not merge if any of these occur:
- The extension clicks Send or sends without a deliberate human action.
- A pre-existing composer draft is modified or lost.
- A request is delivered to a different provider than the reviewed recipient.
- Multiple matching provider tabs are silently resolved by choosing one.
- A refresh/restart causes an automatic retry of an ambiguous dispatch.
- The UI reports success when delivery/preparation outcome is unknown.

A passing manual run is evidence for only the exact browser/provider versions recorded above. Repeat the relevant tests after significant provider UI or extension changes.
