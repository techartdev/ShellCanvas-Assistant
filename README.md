# Canvas Assistant

An independent AI assistant app for [ShellCanvas](https://shellcanvas.com): a
conversation beside your remote files and terminal, with tools that follow the
workspace's actual capabilities.

## Install

In ShellCanvas, open **Apps → Install from GitHub**, enter
`techartdev/ShellCanvas-Assistant` and reference `main`, then review the package
and its permissions. The repository contains a prebuilt package plus a root
`shellcanvas.repo.json` with its SHA-256. Installation downloads those files;
it does not install Node, run build scripts or contact an app registry.

Version 0.1.4 requires a ShellCanvas build with the app network API and
`environment.workspaceId` (conversation host protection). Update the desktop
before updating this app; older desktops cannot send from this version. The first native client
target is Windows. ShellCanvas currently gates installed third-party app windows
on macOS/Linux pending their isolation proofs; a working built-in desktop on
Catalina does not mean installed apps are enabled there.

## Connect a model

Open assistant settings and configure the full endpoint, API key and model ID.
For OpenAI use **https://api.openai.com/v1/responses**. This supports reasoning
models such as GPT-5.6 with function tools. Compatible servers can instead use
their full Chat Completions endpoint (often ending in /v1/chat/completions).
The app chooses Responses for paths ending in /responses; all other paths use
Chat Completions. Tools and images also require model support. Turn off workspace
tools for chat-only models. No model or billing entitlement is supplied by this app.

The endpoint/key form belongs to ShellCanvas. Keys are held by the native host,
optionally remembered in the operating system credential store, and are not
part of the app's history, settings or package. The host will not follow HTTP
redirects or send a retained key to a changed endpoint.

## Working together

Conversations remain readable on any host. Before Send or Continue on a different
workspace, choose a fresh chat (default), return through the desktop host menu,
or create a separate continuation. Choosing a continuation preserves the original
and shows a host-change marker; review it and send your next message explicitly.
Existing chats without verified target identity need this choice once to create
a bound continuation. Reconnecting to the same target does not require branching.

- Conversations and drafts are stored locally per app identity. Another open
  window cannot silently replace a newer saved conversation; use **Save a copy**
  if a revision conflicts. Without storage permission, history is session-only.
- Attach local text/images, select a remote text file, or explicitly attach
  clipboard text/images. Review/remove attachments before sending. Images are
  resized to at most 1600 pixels on their longest side and encoded as JPEG.
- Sending includes conversation text, selected attachments and task-requested
  tool results at your configured model endpoint. Files are not indexed or
  uploaded in the background. Avoid attaching credentials or unrelated secrets.
- Available tools discover the workspace, browse/read files, create/edit text,
  and exchange text with a dedicated console. Edits and console input display
  the exact target and proposed operation for approval.
- A console is an interactive byte stream, not an exec API. Its device and
  paths may differ from the file service. Output does not guarantee success or
  provide a reliable exit code. Consoles close when the turn ends.
- Stop cancels pending work. It cannot undo completed remote operations. Inspect
  uncertain results before retrying. Reconnects do not silently redirect a turn.

Runs default to 30 model rounds and 30 active minutes, configurable in Assistant
settings (any positive whole number of rounds, 1–240 minutes). Approval waiting time is excluded.
There is no separate 20-tool cap; each model response remains bounded to 32 tool
calls. A limit pauses the run with a **Continue task** button and saved results.
Continue starts a new run with current workspace checks and fresh action reviews;
completed actions are not automatically replayed. Stop remains available.
Directory
summaries show up to 500 entries; ShellCanvas Files can browse the whole listing.
Attachments are limited to eight items / 1.8 million encoded characters per
message; the current desktop JSON request limit is 3 MiB. These are agent context
budgets, not remote filesystem limits. Oversized conversations require starting
a new one; automatic summarization is not implemented. History supports chunked
records up to 24 MiB. Clipboard JSON export is available from settings.

## Develop

```sh
npm ci
npm test
npm run build
npm run package:repository
```

The project consumes the distributable `@shellcanvas/app-sdk` tarball in
`vendor/sdk.tgz`. It does not import the desktop source, Tauri IPC or a Node
runtime. Node is needed only to build. The SDK is provisional and not yet
published to npm. After editing, rebuild the package and root descriptor
together, and commit `dist/app.shellcanvas.json` along with the descriptor.

See [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md), and the
[assistant operating skill](skills/canvas-assistant/SKILL.md). The app owns its
conversation UI, streaming parser and tool loop. The desktop owns capability
grants, connection identity, HTTP transport, credentials and native services.

## Verification and scope

`npm test` runs deterministic streaming, tool-loop, cancellation and history
checks. These are fixtures, not evidence of a live provider or remote host.
Native installation, visuals and real-provider checks are recorded separately
in [verification](docs/verification.md).

No scheduler, unattended actions, multi-agent delegation, background indexing,
MCP server installation or automatic cross-host actions are included.

Licensed under MPL-2.0. See [LICENSE](LICENSE).
