# Verification

Verified on 2026-09-10 using the Windows native ShellCanvas desktop. This is a
preview app, not a signed desktop release or a cross-platform certification.

## Actual installed-app checks

- Installed 0.1.0 directly from the public GitHub repository with its package
  digest and permission review. Updated to 0.1.1 through Check update: an existing
  window retained 0.1.0, and a newly opened window used 0.1.1.
- Live OpenAI Responses calls with the user's selected `gpt-5.6-terra` streamed
  text and completed discovery/tool-result rounds. The key was entered only in
  ShellCanvas's trusted dialog. The initial Chat Completions test returned the
  provider's compatibility error, which led to adding Responses support.
- Local chat worked without a host; unavailable file/console tools were omitted.
- Attached a generated text file and green image. The model correctly identified
  their test word and color. Shared remote file selection also delivered the
  isolated test file's exact content to the model.
- Native clipboard text and image attachment previews worked. Draft attachments
  survived switching conversations. Conversation copies and history reload worked.
- On an authorized Linux test host, the model discovered services, listed only an
  isolated fixture, read a file and requested an edit with the exact old/new text.
  After approval, an independent SSH read verified the replacement bytes.
- Declining a create action stopped it without a retry. Stopping another pending
  approval canceled it; an independent host check confirmed no file was created.
  A subsequent message succeeded, confirming the conversation remained usable.
- Reviewed console input and repeated console reads observed a generated marker
  after the login banner. No independent-exec or exit-code claim is made.
- Manual disconnect is blocked while the window is busy. After Stop, disconnect
  preserved chat; reconnect required accepting the new host binding before tools
  became available again. Mid-approval binding replacement is tested by fixtures.
- Checked the native desktop at full size and a compact 700 x 620 viewport:
  composer, attachment preview and scrolling settings remained usable without
  horizontal page overflow.

- Version 0.1.2 was also installed with storage and network grants denied: it displayed session-only history and refused network setup before opening a credential dialog. Approved access was restored, and a live Terra reply succeeded afterward.
- A fresh application restart preserved the installed version, model, endpoint, saved-key presence and an earlier sent-image conversation. The final desktop was reopened without the temporary debugging port.

## Automated checks

Eleven app tests cover split UTF-8/SSE, both API protocols, stateless reasoning
replay, image input mapping, invalid/incomplete streams, tool/cancel results,
chunked history conflicts, denied capabilities, retained edit revisions,
connection changes during review and console UTF-8 split across reads.

ShellCanvas's separate broker tests check permission denial before native access,
window ownership, bounded streams and late-start cancellation. Its repository
checks cover malformed manifests, unsafe paths, identity/digest mismatches,
cancellation and persisted update provenance. The exported SDK was independently
installed into fresh projects outside the desktop checkout and built successfully. A fresh public assistant clone also passed npm ci, all eleven tests, build and repository packaging with no generated worktree changes.

No live host contents, credentials or personal conversation logs are included in
this repository. Test descriptions above are evidence of the stated workflows,
not proof of arbitrary devices, model providers or client platforms.

## Deliberate boundaries

Windows is the first client with a live assistant walkthrough. ShellCanvas
0.1.13 passed native installed-app isolation probes on Linux and Apple Silicon;
real assistant use on those clients, mobile clients, arbitrary HTTP
protocols/headers, autonomous background work,
multiple hosts per turn and WispCrew runtime integration remain future work.
Provider support requires an appropriate streaming Responses or Chat Completions
endpoint. The app has no automatic mutation retry, context compaction, background
file index or model-driven package installation. Native operation timeouts and
context limits are explicit; cancellation cannot reverse an accepted operation.

## Run-control revision (0.1.3)

All 18 tests pass, including tasks beyond the old 12-round/20-tool caps,
30-round pause with paired results, configurable larger budgets, continuation
without replay, per-request context sizing, approval-excluded active time,
cancellation and batched console reads with retained idle reads. Build and
repository packaging pass. A synthetic browser fixture also verified settings
persistence, a 5000-round setting, clean pause/continue, retained drafts and
results, no empty assistant bubbles, and delivery of the communication guidance.
This fixture does not establish how every real model follows that guidance.
