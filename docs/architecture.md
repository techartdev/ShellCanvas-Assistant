# Architecture and boundaries

Canvas Assistant is a separately built, installable app. Its only runtime
dependency on ShellCanvas is the public SDK's isolated, window-owned channel.

| Responsibility                                             | Owner                     |
| ---------------------------------------------------------- | ------------------------- |
| Layout, messages, attachments, review cards                | `main.ts`, `style.css`    |
| Streaming Responses/Chat Completions and bounded tool loop | `agent.ts`                |
| Tool schemas and accepted-workspace operations             | `tools.ts`                |
| Revision-checked conversation records                      | `history.ts`              |
| Endpoint configuration, HTTP, OS credentials               | ShellCanvas `network` API |
| File/console routing, grants, binding revocation           | ShellCanvas host brokers  |

## Protocol

Endpoints ending in `/responses` use the Responses API; other endpoints use Chat
Completions. Responses requests set `store: false`, include encrypted reasoning
context, and replay completed output items with their original tool call IDs.
Opaque reasoning items are retained locally with the conversation and replayed
only to the same endpoint and model. A different provider gets the normalized
visible messages and tool results. A `response.completed` event is required before
any tools run; failed, incomplete and interrupted streams cannot dispatch them.
The [official migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses)
describes this stateless reasoning flow.

In Chat Completions mode, the endpoint is the full URL of a streaming compatible Chat
Completions resource. Requests use `messages`, `stream: true`, and optional
function `tools`. The app parses SSE events across arbitrary UTF-8 chunk
boundaries, accumulates tool-call fragments and executes only complete calls
after a completed model round. Tool results are appended with the original call
ID. Truncated/malformed responses cannot dispatch tools. Cancellation preserves
completed results; pending calls receive canceled results so history does not
contain dangling tool calls. Requests are not automatically retried.

The native host makes a POST to the app's configured exact endpoint using its
current connection revision. The app cannot supply an Authorization header,
read the key, choose a URL per request or follow redirects. Setting up another
endpoint requires the desktop's trusted connection form. A changed endpoint
requires entering a new key, rather than forwarding a previous key silently.

## Tools

Discover method availability and grants before offering tools. Capture the
accepted binding for the turn. Check it before each remote action and after
approval. Reads retain file revisions; edits use the retained document, never a
fresh revision selected just to bypass a conflict. Console input is reviewed
verbatim. A console's transport may differ from the file provider; do not infer
that a file path belongs to its shell. There is no hidden native exec fallback.

Approval UI belongs to this trusted assistant app. The host separately enforces
the app's installation grants and source binding. A malicious installed app is
not obliged to implement the assistant's per-action approval flow; grant only
the access you trust that package to use.

## History and attachments

Immutable conversation chunks are written before a revision-checked header
commit. A conflict preserves the other writer's header and removes the new
unreferenced chunks. Old chunks are removed after a successful header update.
History is per app identity, separate from credentials. Without storage grants,
an explicit memory-only backend keeps this window usable.

Attachments are deliberate context. Local file input is user-selected browser
file access; remote selections use shared ShellCanvas dialogs and retained
bindings. Clipboard access uses separately granted SDK services. Binary files
are not treated as text; images are resized and displayed before sending.

## Sources

The [official Chat Completions reference](https://developers.openai.com/api/reference/resources/chat)
describes the wire format. No OpenAI SDK, CLI or Node sidecar runs in the app.
The design follows ShellCanvas's existing optional WispCrew assessment; no
WispCrew implementation or local-shell tool defaults were copied.

## Run control

Run limits are user settings, defaulting to 30 model rounds and 30 active
minutes. The active deadline aborts pending work but pauses during action review.
All emitted tool calls receive results, including canceled calls, before a run
pauses; round limits are checked between complete model/tool exchanges. Continue
is an explicit new user request using saved results and a freshly accepted
workspace/toolkit, not a replay of previous calls or approvals. The previous
console is closed. The request-size budget is checked before every model round.
Communication guidance requests a brief initial plan, occasional meaningful
updates and an outcome. Tool-only replies render tool cards without blank bubbles.

Console reads batch nearby byte fragments (up to roughly 64k characters or one
second of collection, with a 150 ms quiet window). An idle wait returns after
10 seconds without canceling the stream; the next read reuses the pending read.
This bounds each result without consuming a model round for every SSH fragment.

## Conversation host boundaries

A conversation stores the SDK's opaque `workspaceId` separately from its display
name and ephemeral accepted `binding`. Send and Continue check it before any
provider request, even with tools disabled. Reconnecting to the same configured
target preserves identity; different targets, accounts, or composite source
configurations require a choice. This is target association, not machine authentication.

Chats remain readable everywhere. The default is a fresh chat. Choosing a
continuation saves a new conversation with a visible boundary and explicit model
instructions to discover the new workspace; original history/draft stay intact.
Opaque provider reasoning is removed from the branch, while visible paired tool
history remains reference context. No approvals, live consoles or file revisions
are reused. Choosing a destination does not send a message; the user reviews the
new conversation before sending. Returning to the original host uses the desktop
host selector (the SDK does not give this app permission to switch workspaces).

Legacy chats have only a label and therefore require an explicit choice, even
when the label matches. Unknown identity or unaccepted/disconnected environments
cannot send. Older desktops without workspaceId must be updated. A connection
change while confirmation is open invalidates that choice.

Workspace labels use the user-chosen connection name plus the SDK's optional
non-secret target description. Labels never participate in identity comparison.
Legacy warnings explicitly say the original target is unknown; they do not claim
a mismatch or offer a return action to an unknowable original target.
