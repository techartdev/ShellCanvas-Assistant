# Working on Canvas Assistant

This is a standalone ShellCanvas app. Use only `@shellcanvas/app-sdk`; do not
import a desktop checkout, Tauri APIs, native handles or Node APIs into app code.
The SDK tarball is intentionally vendored until registry publication.

- `main.ts` owns presentation, drafts, attachments and explicit action review.
- `agent.ts` owns the OpenAI-compatible streaming protocol and bounded tool loop.
- `tools.ts` maps the accepted workspace to optional SDK services.
- `history.ts` persists chunked conversations with revision checks.
- `style.css` is the full isolated app theme. Preserve its visual quality and
  compact layout. Render model and host content as text, never raw HTML.

Read `docs/architecture.md` and `skills/canvas-assistant/SKILL.md` before changing
tool behavior. Missing capabilities disable tools; they do not justify hidden
shell fallbacks. Retain accepted binding and file revisions through approvals.
Never expose model keys to app code or record them in fixtures/history.

Run `npm test`, `npm run build`, and `npm run package:repository` after relevant
changes. Installation must work from the prebuilt package without rebuilding
ShellCanvas. Changes to the public API need desktop/SDK tests as well as app
tests. Distinguish fixtures, native installed UI and real-provider evidence.

The app repository may be public. Do not include live host contents, credentials,
API keys, private desktop logs, or personal conversation history in commits.
