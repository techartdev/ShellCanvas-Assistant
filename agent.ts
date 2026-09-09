// SPDX-License-Identifier: MPL-2.0
import type { AppConnection, AppNetworkAPI, Json } from "@shellcanvas/app-sdk";
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string | Json[] | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface Tool { name: string; description: string; parameters: Json; run(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> }
export interface TurnOptions {
  network: AppNetworkAPI; connection: AppConnection; model: string; messages: Message[]; tools: Tool[]; signal: AbortSignal;
  onText(text: string): void; onTool(call: ToolCall, state: "running" | "done" | "failed", result?: string): void;
  onRound(): void;
}
export async function* sseEvents(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder(); let carry = "", data: string[] = [];
  for await (const chunk of chunks) {
    carry += decoder.decode(chunk, { stream: true });
    if (carry.length > 1024 * 1024) throw new Error("The model returned an oversized streaming event.");
    let end: number;
    while ((end = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, end).replace(/\r$/, ""); carry = carry.slice(end + 1);
      if (!line) { if (data.length) yield data.join("\n"); data = []; }
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      if (data.join("").length > 1024 * 1024) throw new Error("The model returned an oversized streaming event.");
    }
  }
  carry += decoder.decode();
  if (carry.startsWith("data:")) data.push(carry.slice(5).trimStart());
  if (data.length) yield data.join("\n");
}
export async function completion(options: TurnOptions): Promise<Message> {
  const response = await options.network.postJSON({ slot: "model", revision: options.connection.revision, body: {
    model: options.model, messages: options.messages as unknown as Json, stream: true,
    ...(options.tools.length ? { tools: options.tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" } : {}),
  } }, options.signal);
  async function* chunks() { while (true) { const bytes = await response.read(options.signal); if (bytes === null) return; yield bytes; } }
  try {
    if (response.status < 200 || response.status >= 300) {
      let error = ""; const decoder = new TextDecoder();
      for await (const bytes of chunks()) { error += decoder.decode(bytes, { stream: true }); if (error.length > 16000) break; }
      let detail = ""; try { const parsed = JSON.parse(error); detail = String(parsed.error?.message ?? parsed.message ?? "").slice(0, 500); } catch { /* Do not display arbitrary HTML error pages. */ }
      throw new Error(`Model endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ". Check the endpoint, key and model."}`);
    }
    let text = "", finish = "";
    const calls = new Map<number, ToolCall>();
    for await (const event of sseEvents(chunks())) {
      options.signal.throwIfAborted();
      if (event === "[DONE]") break;
      let parsed: any; try { parsed = JSON.parse(event); } catch { throw new Error("The model returned malformed streaming JSON."); }
      if (parsed.error) throw new Error(String(parsed.error.message ?? "Model stream failed.").slice(0, 500));
      const choice = parsed.choices?.[0]; if (!choice) continue;
      if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string") {
        text += delta.content; if (text.length > 512000) throw new Error("Model response is too large for one turn.");
        options.onText(text);
      }
      for (const item of delta.tool_calls ?? []) {
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= 32) throw new Error("Invalid model tool-call index.");
        const call = calls.get(item.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (typeof item.id === "string") call.id += item.id;
        if (typeof item.function?.name === "string") call.function.name += item.function.name;
        if (typeof item.function?.arguments === "string") call.function.arguments += item.function.arguments;
        if (call.id.length > 200 || call.function.name.length > 100 || call.function.arguments.length > 256000) throw new Error("Model tool call exceeds its size limit.");
        calls.set(item.index, call);
      }
    }
    if (!finish) throw new Error("Model stream ended before completion. Partial text is preserved; no tools were executed.");
    if (finish === "length" || finish === "content_filter") throw new Error(`Model stopped (${finish}). Partial text is preserved; no tools were executed.`);
    const toolCalls = [...calls.entries()].sort((a,b) => a[0] - b[0]).map(([,call]) => call);
    if (toolCalls.some(call => !call.id || !call.function.name) || new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) throw new Error("Model returned incomplete or duplicate tool calls.");
    return { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  } finally { await response.close().catch(() => {}); }
}
export async function runAgent(options: TurnOptions): Promise<void> {
  const started = Date.now(); let toolsUsed = 0;
  for (let step = 0; step < 12; step++) {
    options.signal.throwIfAborted();
    if (Date.now() - started > 300000) throw new Error("This turn reached five minutes. Review the results before continuing.");
    options.onRound();
    const message = await completion(options);
    options.messages.push(message);
    if (!message.tool_calls?.length) return;
    for (const call of message.tool_calls) {
      let result: unknown, failed = false;
      options.onTool(call, "running");
      try {
        options.signal.throwIfAborted();
        if (++toolsUsed > 20) throw new Error("This turn reached its 20-tool limit.");
        const tool = options.tools.find(tool => tool.name === call.function.name);
        if (!tool) throw new Error("This tool is unavailable in the accepted workspace.");
        const args: unknown = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object.");
        result = await tool.run(args as Record<string, unknown>, options.signal);
      } catch (error) { failed = true; result = { error: error instanceof Error ? error.message : String(error), ...(options.signal.aborted ? { canceled: true, note: "A dispatched remote operation may have completed. Inspect before retrying." } : {}) }; }
      let content = JSON.stringify(result ?? null);
      if (content.length > 180000) content = JSON.stringify({ truncated: true, excerpt: content.slice(0, 170000), note: "Narrow the request to inspect the remaining content." });
      options.messages.push({ role: "tool", tool_call_id: call.id, content });
      options.onTool(call, failed ? "failed" : "done", content);
    }
  }
  throw new Error("This turn reached its 12-step limit. Review the results before continuing.");
}
