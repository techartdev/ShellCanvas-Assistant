// SPDX-License-Identifier: MPL-2.0
import { connectToShellCanvas, type ExtensionClient, type AppConnection, type AppEnvironment, type AppValue, type Json } from "@shellcanvas/app-sdk";
import { runAgent, type Message, type ToolCall } from "./agent";
import { workspaceTools, operatingGuide, type ReviewAction } from "./tools";
import { History, type Conversation, type Attachment } from "./history";
import { memoryStorage } from "./memory-storage";
const icons: Record<string,string> = {
  spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', arrow:'<path d="M12 19V5m-6 6 6-6 6 6"/>', stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  attach:'<path d="m8 12 6-6a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-8-8l9-9m-6 10 8-8a2 2 0 0 1 3 3l-8 8a2 2 0 0 1-3-3"/>',
  terminal:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  folder:'<path d="M3 7V5h6l2 2h10v13H3Z"/>', file:'<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  clipboard:'<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', check:'<path d="m5 12 4 4 10-10"/>', trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
};
const icon = (name: string) => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.spark}</svg>`;
const root = document.querySelector<HTMLDivElement>("#root")!;
root.innerHTML = `<main class="assistant-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon("spark")}</span><span>Canvas<span class="brand-sub">ASSISTANT</span></span></div><button id="new-chat" class="new-chat">${icon("plus")}New conversation<span>⌘ N</span></button><div class="history-heading">YOUR CONVERSATIONS<button id="refresh-history" class="icon-button" title="Refresh conversations" aria-label="Refresh conversations">↻</button></div><nav id="history" aria-label="Conversations"></nav><div class="sidebar-bottom"><span class="privacy-dot"></span><div>History stays here<small>Stored locally in ShellCanvas</small></div></div></aside><section class="conversation"><header class="chat-header"><button id="toggle-sidebar" class="icon-button mobile-menu" aria-label="Toggle conversation list">${icon("menu")}</button><div><div class="workspace-label"><span class="status-dot"></span><span id="host-name">Your workspace</span></div><span class="workspace-caption" id="host-caption">A little help, right where you work.</span></div><div class="header-actions"><button id="model-button" class="model-button">${icon("spark")}<span id="model-label">Connect a model</span><span>⌄</span></button><button id="settings" class="icon-button" aria-label="Assistant settings" title="Assistant settings">${icon("settings")}</button></div></header><div id="notice" class="notice" role="status" hidden></div><div id="messages" class="messages" tabindex="0"><section id="welcome" class="welcome"><div class="welcome-mark">${icon("spark")}</div><p class="eyebrow">A THOUGHTFUL PAIR OF HANDS</p><h1>Make room for<br><em>what comes next.</em></h1><p class="welcome-description">Explore your host, untangle a problem, or turn an idea into a few less things to do.</p><div class="suggestions"><button data-prompt="Help me understand this workspace. Discover its available services and explain what we can do here.">${icon("terminal")}<span>Get to know this host<small>Start with a little orientation</small></span>↗</button><button data-prompt="Explore the default file directory and summarize what is there without reading sensitive files.">${icon("folder")}<span>Find my way around<small>Explore files and folders</small></span>↗</button><button data-prompt="I have a problem to investigate. Help me narrow it down step by step, and ask what symptoms I am seeing.">${icon("spark")}<span>Untangle a problem<small>Think it through together</small></span>↗</button><button data-prompt="Help me review a configuration file. I will attach or choose the file; explain it before proposing edits.">${icon("file")}<span>Review a configuration<small>Understand before changing</small></span>↗</button></div></section><div id="thread" aria-live="off"></div></div><div class="composer-area"><div id="activity" class="activity" hidden></div><section id="approval" class="approval" hidden aria-label="Review assistant action"><p class="eyebrow">YOUR REVIEW</p><h3></h3><p class="approval-target"></p><pre tabindex="0"></pre><div><button id="deny-action">Decline</button><button id="approve-action" class="primary">Approve this action</button></div></section><div class="composer"><div id="attachments" class="attachments"></div><textarea id="prompt" rows="2" placeholder="Ask anything about your workspace…" aria-label="Message Canvas Assistant"></textarea><div class="composer-tools"><div><button id="attach-local" class="icon-button" aria-label="Attach local files" title="Attach local text or images">${icon("attach")}</button><button id="attach-remote" class="icon-button" aria-label="Attach remote file" title="Choose a remote text file">${icon("folder")}</button><button id="paste-attachment" class="icon-button" aria-label="Attach from clipboard" title="Attach clipboard image or text">${icon("clipboard")}</button><span class="composer-hint">Enter to send · Shift + Enter for a new line</span></div><button id="send" class="send-button" aria-label="Send message" title="Send message">${icon("arrow")}</button></div></div><div class="composer-footer"><span id="tools-label">Connecting to your desktop…</span><span>Changes stay in your hands.</span></div></div></section><section id="settings-panel" class="settings-panel" hidden aria-label="Assistant settings"><header><div><p class="eyebrow">MAKE IT YOURS</p><h2>Your assistant</h2></div><button id="close-settings" class="icon-button" aria-label="Close settings">${icon("close")}</button></header><label>Model<input id="model-input" placeholder="Enter a model ID" spellcheck="false"/></label><p class="settings-help">Use the model ID provided by your OpenAI-compatible server.</p><div class="connection-card"><span class="eyebrow">MODEL CONNECTION</span><p id="endpoint-label">No endpoint configured</p><button id="configure-model">Configure endpoint & key</button><button id="forget-model" class="quiet">Forget connection</button></div><label class="setting-check"><input id="tools-enabled" type="checkbox" checked/><span>Allow workspace tools<small>Reads follow your task. Changes and console input require your review.</small></span></label><p class="settings-help">Your messages, selected attachments and requested tool results are sent to this endpoint when you send. History and credentials stay separate.</p><div class="settings-actions"><button id="save-settings" class="primary">Save settings</button><button id="export-chat">Export conversation</button><button id="duplicate-chat">Save a copy</button><button id="delete-chat" class="danger">Delete conversation</button></div></section><input id="local-files" type="file" accept="image/png,image/jpeg,image/webp,.txt,.md,.json,.yaml,.yml,.toml,.ini,.conf,.log,.csv,.ts,.js,.py,.rs,.sh,.xml,.html,.css" multiple hidden/></main>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = $<HTMLTextAreaElement>("prompt");
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; }
function notify(message: string, error = false) { const notice = $("notice"); notice.textContent = message; notice.hidden = !message; notice.classList.toggle("error", error); }
function fresh(): Conversation { return { version: 1, id: crypto.randomUUID(), title: "New conversation", updated: Date.now(), messages: [], draft: "", attachments: [], host: "" }; }
let client: ExtensionClient, history: History, conversation = fresh(), record: AppValue | null = null;
let connection: AppConnection | null = null, environment: AppEnvironment, model = "", settingsRecord: AppValue | null = null;
let busy = false, dirty = false, ready = false, toolsEnabled = true, saveTimer: ReturnType<typeof setTimeout> | undefined, saves: Promise<void> = Promise.resolve();
let active: AbortController | null = null, currentAssistant: HTMLElement | null = null, currentAssistantText = "";
let pendingReview: ((approved: boolean) => void) | null = null;
const toolCards = new Map<string, HTMLElement>();
const report = (error: unknown) => notify(error instanceof Error ? error.message : String(error), true);
function updateDocument() { if (client) void client.window.setDocumentState({ dirty, busy, title: conversation.title === "New conversation" ? "Canvas Assistant" : conversation.title }).catch(report); }
function changed() { dirty = true; conversation.updated = Date.now(); updateDocument(); clearTimeout(saveTimer); saveTimer = setTimeout(() => { void save().catch(report); }, 700); }
function save() {
  clearTimeout(saveTimer);
  const id = conversation.id, snapshot = structuredClone(conversation), timestamp = conversation.updated;
  const task = saves.then(async () => {
    if (conversation.id !== id) return;
    record = await history.save(snapshot, record);
    if (conversation.updated === timestamp) { dirty = false; updateDocument(); }
    await renderHistory();
  });
  saves = task.catch(() => {}); return task;
}
async function renderHistory() {
  const list = $("history"); const rows = await history.list(); list.replaceChildren();
  if (!rows.length) list.append(el("p", "history-empty", "Your next conversation starts here."));
  for (const row of rows) {
    const button = el("button", `history-item${row.id === conversation.id ? " selected" : ""}`);
    button.append(el("span", "", row.title), el("small", "", new Date(row.updated).toLocaleDateString(undefined, { month:"short", day:"numeric" })));
    button.disabled = busy; button.onclick = () => { void switchConversation(row.id).catch(report); }; list.append(button);
  }
}
async function switchConversation(id?: string) {
  if (busy) return;
  if (dirty) await save(); await saves;
  if (id) { const loaded = await history.load(id); conversation = loaded.conversation; record = loaded.record; }
  else { conversation = fresh(); record = null; }
  dirty = false; prompt.value = conversation.draft; notify(""); renderThread(); renderAttachments(); updateDocument(); await renderHistory();
  root.classList.remove("sidebar-open"); prompt.focus();
}
function richText(container: HTMLElement, text: string) {
  container.replaceChildren();
  const segments = text.split(/```/g);
  segments.forEach((segment, index) => {
    if (index % 2) { const newline = segment.indexOf("\n"); const language = newline >= 0 ? segment.slice(0,newline).trim() : ""; const code = newline >= 0 ? segment.slice(newline+1) : segment;
      const block = el("div", "code-block"), top = el("div", "code-header", language || "code"), copy = el("button", "icon-button"); copy.innerHTML = icon("copy"); copy.title = "Copy code"; copy.setAttribute("aria-label", "Copy code"); copy.onclick = () => { void client.clipboard.writeText(code).then(() => notify("Code copied.")).catch(report); }; top.append(copy); block.append(top, el("pre", "", code)); container.append(block); return;
    }
    for (const line of segment.split("\n")) {
      const heading = /^(#{1,3})\s+(.*)/.exec(line);
      const paragraph = el(heading ? "h3" : "p", /^\s*[-*]\s/.test(line) ? "text-bullet" : "");
      const parts = (heading ? heading[2] : line).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      for (const part of parts) paragraph.append(part.startsWith("**") && part.endsWith("**") ? el("strong", "", part.slice(2,-2)) : part.startsWith("`") && part.endsWith("`") ? el("code", "inline-code", part.slice(1,-1)) : document.createTextNode(part));
      container.append(paragraph);
    }
  });
}
function messageCard(role: "user" | "assistant", content: string) {
  const article = el("article", `message ${role}`), avatar = el("div", "avatar"), body = el("div", "message-main");
  avatar.innerHTML = role === "assistant" ? icon("spark") : "Y";
  body.append(el("div", "message-author", role === "assistant" ? "Canvas" : "You"));
  const text = el("div", "message-content"); richText(text, content); body.append(text); article.append(avatar, body); $("thread").append(article); return text;
}
function renderThread() {
  $("thread").replaceChildren(); toolCards.clear(); $("welcome").hidden = conversation.messages.length > 0 || !!conversation.partial;
  for (const message of conversation.messages) {
    if (message.role === "user" || message.role === "assistant") {
      let content = typeof message.content === "string" ? message.content : "";
      if (Array.isArray(message.content)) content = message.content.filter((part): part is {type:string;text:string} => !!part && typeof part === "object" && !Array.isArray(part) && part.type === "text" && typeof part.text === "string").map(part => part.text).join("\n\n");
      const card = messageCard(message.role, content);
      if (Array.isArray(message.content)) for (const part of message.content) {
        if (part && typeof part === "object" && !Array.isArray(part) && part.type === "image_url" && part.image_url && typeof part.image_url === "object" && !Array.isArray(part.image_url) && typeof part.image_url.url === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(part.image_url.url)) { const img = el("img", "message-image"); img.src = part.image_url.url; img.alt = "Attached image"; card.append(img); }
      }
      for (const call of message.tool_calls ?? []) toolCard(call, "done");
    } else if (message.role === "tool" && message.tool_call_id) { const card = toolCards.get(message.tool_call_id); if (card && typeof message.content === "string") { card.querySelector("pre")!.textContent = message.content; card.querySelector("span")!.textContent = message.content.includes('"error":') ? "Needs attention" : "Completed"; } }
  }
  if (conversation.partial) { const card = messageCard("assistant", conversation.partial); card.append(el("small", "partial-label", "Interrupted response")); }
  if (conversation.error) notify(conversation.error, true);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function toolCard(call: ToolCall, state: "running" | "done" | "failed", result?: string) {
  let card = toolCards.get(call.id);
  if (!card) { card = el("details", "tool-card"); const summary = el("summary"); const name = el("strong", "", call.function.name.replaceAll("_", " ")); summary.innerHTML = icon("terminal"); summary.append(name, el("span")); card.append(summary, el("pre", "", call.function.arguments)); $("thread").append(card); toolCards.set(call.id, card); }
  card.dataset.state = state; card.querySelector("span")!.textContent = state === "running" ? "Working…" : state === "failed" ? "Needs attention" : "Completed";
  if (result) card.querySelector("pre")!.textContent = result;
}
function renderAttachments() {
  const area = $("attachments"); area.replaceChildren();
  for (const attachment of conversation.attachments) {
    const chip = el("div", "attachment-chip");
    if (attachment.kind === "image") { const img = el("img"); img.src = attachment.content; img.alt = attachment.name; chip.append(img); } else { const mark = el("span"); mark.innerHTML = icon("file"); chip.append(mark); }
    chip.append(el("span", "attachment-name", attachment.name)); const remove = el("button", "icon-button"); remove.innerHTML = icon("close"); remove.setAttribute("aria-label", `Remove ${attachment.name}`); remove.disabled = busy; remove.onclick = () => { conversation.attachments = conversation.attachments.filter(value => value.id !== attachment.id); renderAttachments(); changed(); }; chip.append(remove); area.append(chip);
  }
}
function addAttachment(attachment: Omit<Attachment,"id">) {
  if (busy) throw new Error("Wait for the current response before adding context.");
  if (conversation.attachments.length >= 8 || conversation.attachments.reduce((size,item) => size + item.content.length,0) + attachment.content.length > 1800000) throw new Error("Attach up to eight items totaling 1.8 million characters per message. Use a smaller image or select a text excerpt.");
  conversation.attachments.push({ ...attachment, id: crypto.randomUUID() }); renderAttachments(); changed();
}
async function imageAttachment(blob: Blob, name: string) {
  if (blob.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MiB.");
  const url = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Cannot read image.")); reader.readAsDataURL(blob); });
  try { const img = new Image(); img.src = url; await img.decode(); const scale = Math.min(1, 1600 / Math.max(img.naturalWidth,img.naturalHeight)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(img.naturalWidth*scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight*scale)); const context = canvas.getContext("2d")!; context.fillStyle = "#ffffff"; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(img,0,0,canvas.width,canvas.height); addAttachment({ name, kind:"image", content: canvas.toDataURL("image/jpeg", .84) }); }
  finally { /* The source is a user-selected data URL allowed by the isolated app CSP. */ }
}
const review: ReviewAction = (action, signal) => new Promise(resolve => {
  if (signal.aborted) { resolve(false); return; }
  const panel = $("approval"); panel.hidden = false; panel.querySelector("h3")!.textContent = action.title; panel.querySelector(".approval-target")!.textContent = `Target: ${action.target}`; panel.querySelector("pre")!.textContent = action.detail;
  const finish = (approved: boolean) => { signal.removeEventListener("abort",abort); pendingReview = null; panel.hidden = true; resolve(approved); };
  const abort = () => finish(false); pendingReview = finish; signal.addEventListener("abort",abort,{once:true}); $("deny-action").onclick = () => finish(false); $("approve-action").onclick = () => finish(true); $("deny-action").focus();
});
function setBusy(value: boolean) {
  busy = value; prompt.disabled = value;
  for (const id of ["new-chat","configure-model","forget-model","save-settings","model-input","tools-enabled","attach-local","attach-remote","paste-attachment","delete-chat","duplicate-chat"]) ($<HTMLButtonElement>(id)).disabled = value;
  $("send").innerHTML = icon(value ? "stop" : "arrow"); $("send").setAttribute("aria-label", value ? "Stop response" : "Send message"); $("send").title = value ? "Stop response" : "Send message"; $("activity").hidden = !value; $("activity").textContent = value ? "Canvas is thinking…" : "";
  updateDocument(); void renderHistory().catch(report);
}
async function send() {
  if (busy) { active?.abort(new Error("Stopped by you.")); pendingReview?.(false); return; }
  if (!ready) return;
  if (!connection || !model.trim()) { showSettings(true); notify("Choose an endpoint and model to begin."); return; }
  if (!prompt.value.trim() && !conversation.attachments.length) return;
  const accepted = await client.environment.get();
  const turn = new AbortController(); active = turn;
  const deadline = setTimeout(() => turn.abort(new Error("Turn reached its five-minute limit.")), 300000);
  let toolkit: Awaited<ReturnType<typeof workspaceTools>> | undefined;
  setBusy(true); notify(""); conversation.error = ""; conversation.partial = "";
  try {
    toolkit = await workspaceTools(client,accepted,review);
    const text = prompt.value.trim(); const content: Json[] = [{ type:"text", text }];
    for (const attachment of conversation.attachments) content.push(attachment.kind === "image" ? { type:"image_url", image_url:{url:attachment.content} } : { type:"text", text:`Attached file: ${attachment.name}\n<untrusted_attachment>\n${attachment.content}\n</untrusted_attachment>` });
    const user: Message = { role:"user", content: conversation.attachments.length ? content : text };
    const messages: Message[] = [{ role:"system", content: operatingGuide + `\nAccepted workspace: ${JSON.stringify(accepted)}` }, ...conversation.messages, user];
    if (new TextEncoder().encode(JSON.stringify(messages)).length > 2600000) throw new Error("This conversation is too large for one model request. Export it or start a new conversation with a summary.");
    conversation.messages.push(user); conversation.title = conversation.title === "New conversation" ? (text || "Image conversation").slice(0,60) : conversation.title;
    conversation.host = accepted.host?.name ?? "Local workspace"; conversation.draft = ""; conversation.attachments = []; prompt.value = ""; changed(); renderThread(); renderAttachments();
    const initial = messages.length; let persisted = initial;
    const sync = () => { conversation.messages.push(...messages.slice(persisted)); persisted = messages.length; changed(); };
    currentAssistant = null; currentAssistantText = "";
    try {
      await runAgent({ network:client.network, connection, model:model.trim(), messages, tools:toolsEnabled ? toolkit.tools : [], signal:turn.signal,
        onRound() { sync(); currentAssistant = null; currentAssistantText = ""; },
        onText(text) { const scroller = $("messages"), follow = scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight < 100; currentAssistant ??= messageCard("assistant", ""); currentAssistantText = text; richText(currentAssistant,text); $("activity").textContent = "Writing…"; if (follow) scroller.scrollTop=scroller.scrollHeight; },
        onTool(call,state,result) { sync(); toolCard(call,state,result); $("activity").textContent = state === "running" ? `Using ${call.function.name.replaceAll("_"," ")}…` : "Thinking about the result…"; },
      });
      sync();
    } catch (error) { sync(); if (currentAssistantText && messages.at(-1)?.content !== currentAssistantText) conversation.partial = currentAssistantText; throw error; }
  } catch (error) {
    conversation.error = turn.signal.aborted ? "Stopped. Completed actions remain completed; inspect any uncertain remote outcome before retrying." : error instanceof Error ? error.message : String(error);
    report(conversation.error); changed();
  } finally { clearTimeout(deadline); await toolkit?.close(); active = null; setBusy(false); renderThread(); await save().catch(report); prompt.focus(); }
}
function showSettings(show: boolean) { $("settings-panel").hidden = !show; root.classList.toggle("settings-open",show); if (show) { $<HTMLInputElement>("model-input").value=model; $<HTMLInputElement>("tools-enabled").checked=toolsEnabled; updateConnection(); } }
function updateConnection() { $("model-label").textContent = model || "Connect a model"; $("endpoint-label").textContent=connection?.endpoint ?? "No endpoint configured"; }
async function refreshEnvironment() {
  environment = await client.environment.get(); $("host-name").textContent=environment.host?.name ?? (environment.connection === "local" ? "Local workspace" : "Remote workspace");
  $("host-caption").textContent = environment.connection === "connected" ? environment.host?.system || "Connected through ShellCanvas" : environment.connection === "review-required" ? "Accept the new connection in the window bar" : environment.connection === "disconnected" ? "Disconnected · conversations stay available" : "Connect a host to use workspace tools";
  const methods = await client.services.list(); const available = methods.filter(method=>method.available&&method.granted);
  $("tools-label").textContent = toolsEnabled ? (environment.connection === "connected" ? "Workspace tools ready · changes require review" : "Chat is ready · no remote tools connected") : "Chat only · workspace tools off";
  const allowed = (name:string)=>available.some(method=>method.name===name);
  $<HTMLButtonElement>("attach-remote").disabled=busy||!allowed("system.files.readText")||!allowed("system.dialogs.openFile");
  $<HTMLButtonElement>("paste-attachment").disabled=busy||(!allowed("system.clipboard.readStart")&&!allowed("system.clipboard.image.readStart"));
  if (active && environment.connection !== "connected" && conversation.host !== "Local workspace") active.abort(new Error("Connection changed."));
}
async function start() {
  client = await connectToShellCanvas();
  const access = await client.services.list();
  if (!access.some(method=>method.name==="system.storage.put"&&method.available&&method.granted)) {
    client={...client,storage:memoryStorage(),settings:memoryStorage()};
    const privacy=root.querySelector(".sidebar-bottom > div")!;privacy.textContent="Session-only history";privacy.append(el("small","","Storage permission is not granted"));
    notify("History is available for this window only because storage permission was not granted.");
  }
  history = new History(client.storage);
  settingsRecord=await client.settings.get("preferences"); const preferences=settingsRecord?.value as {model?:string;toolsEnabled?:boolean}|undefined;
  model=preferences?.model ?? ""; toolsEnabled=preferences?.toolsEnabled !== false;
  await client.network.profile("model").then(value=>connection=value).catch(report);
  await refreshEnvironment(); updateConnection(); await renderHistory(); ready=true; prompt.focus();
  const unsubscribe=client.events.subscribe(()=>{void refreshEnvironment().catch(report);},report);
  window.addEventListener("pagehide",()=>{active?.abort();pendingReview?.(false);unsubscribe();client.dispose();},{once:true});
  $("send").onclick=()=>{void send().catch(report);};
  $("new-chat").onclick=()=>{void switchConversation().catch(report);}; $("refresh-history").onclick=()=>{void renderHistory().catch(report);};
  prompt.oninput=()=>{conversation.draft=prompt.value;changed();};
  prompt.onkeydown=event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();void send().catch(report);}};
  $("toggle-sidebar").onclick=()=>root.classList.toggle("sidebar-open");
  for(const id of ["settings","model-button"]) $(id).onclick=()=>showSettings($("settings-panel").hidden);
  $("close-settings").onclick=()=>showSettings(false);
  $("configure-model").onclick=()=>{void client.network.configure({slot:"model",suggestedEndpoint:connection?.endpoint??"https://api.openai.com/v1/chat/completions"}).then(value=>{if(value)connection=value;updateConnection();}).catch(report);};
  $("forget-model").onclick=()=>{void client.network.forget("model").then(()=>{connection=null;updateConnection();notify("Connection forgotten.");}).catch(report);};
  $("save-settings").onclick=()=>{void (async()=>{const value=$<HTMLInputElement>("model-input").value.trim();if(!value||value.length>200)throw new Error("Enter a model ID of 1–200 characters.");const next=await client.settings.put("preferences",{model:value,toolsEnabled:$<HTMLInputElement>("tools-enabled").checked},settingsRecord?.revision??null);settingsRecord=next;model=value;toolsEnabled=$<HTMLInputElement>("tools-enabled").checked;updateConnection();await refreshEnvironment();showSettings(false);notify("Assistant settings saved.");})().catch(report);};
  $("export-chat").textContent="Copy conversation JSON";
  $("export-chat").onclick=()=>{void client.clipboard.writeText(JSON.stringify(conversation,null,2)).then(()=>notify("Conversation JSON copied. Paste it into a local file to keep an export.")).catch(report);};
  $("duplicate-chat").onclick=()=>{void (async()=>{await saves;conversation={...structuredClone(conversation),id:crypto.randomUUID(),title:conversation.title+" (copy)"};record=null;changed();await save();notify("Saved as a separate conversation.");})().catch(report);};
  $("delete-chat").onclick=()=>{void (async()=>{const result=await client.system.dialogs.messageBox({title:"Delete conversation?",message:`Delete “${conversation.title}” and its local attachments?`,kind:"warning",buttons:[{id:"cancel",label:"Keep conversation"},{id:"delete",label:"Delete",destructive:true}],cancelId:"cancel",defaultId:"cancel"});if(result!=="delete")return;clearTimeout(saveTimer);await saves;await history.remove(conversation.id);dirty=false;conversation=fresh();record=null;await switchConversation();showSettings(false);})().catch(report);};
  $("attach-local").onclick=()=>$<HTMLInputElement>("local-files").click();
  $<HTMLInputElement>("local-files").onchange=event=>{const files=Array.from((event.target as HTMLInputElement).files??[]);(event.target as HTMLInputElement).value="";void (async()=>{for(const file of files){if(file.type.startsWith("image/"))await imageAttachment(file,file.name);else{if(file.size>300000)throw new Error("Choose a text file smaller than 300 KB, or paste an excerpt.");const text=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());if(text.includes("\0"))throw new Error("This appears to be a binary file. Attach a text file or image.");addAttachment({name:file.name,kind:"text",content:text});}}})().catch(report);};
  $("attach-remote").onclick=()=>{void (async()=>{const accepted=await client.environment.get();if(!accepted.binding)throw new Error("Connect a host first.");const files=await client.system.dialogs.openFile({title:"Attach remote text",multiple:true});for(const file of files??[]){const doc=await client.files.readText({binding:accepted.binding,path:file.path});addAttachment({name:doc.name,kind:"text",content:doc.text});}})().catch(report);};
  $("paste-attachment").onclick=()=>{void (async()=>{let image;try{image=await client.clipboard.readImage();}catch{/* A text-only clipboard is ordinary. */}if(image){const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba),image.width,image.height),0,0);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("Cannot encode clipboard image.")),"image/png"));await imageAttachment(blob,"Clipboard image");}else{const text=await client.clipboard.readText();if(!text)throw new Error("No text or image on the clipboard.");addAttachment({name:"Clipboard text",kind:"text",content:text});}})().catch(report);};
  for(const button of root.querySelectorAll<HTMLButtonElement>("[data-prompt]"))button.onclick=()=>{prompt.value=button.dataset.prompt!;conversation.draft=prompt.value;changed();prompt.focus();};
}
void start().catch(error=>{report(error);$("tools-label").textContent="Desktop services unavailable";});
