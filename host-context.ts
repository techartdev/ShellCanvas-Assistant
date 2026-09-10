// SPDX-License-Identifier: MPL-2.0
import type { AppEnvironment } from "@shellcanvas/app-sdk";
import type { Conversation } from "./history";

export interface HostContext {
  id: string;
  name: string;
}
export interface HostChange {
  from: string;
  to: string;
  at: number;
  messageIndex: number;
  parentId: string;
}
export function currentHost(environment: AppEnvironment): HostContext | null {
  if (
    environment.connection !== "local" &&
    environment.connection !== "connected"
  )
    return null;
  const id = environment.workspaceId;
  return id ? { id, name: environment.host?.name ?? "Local workspace" } : null;
}
export function needsHostChoice(
  conversation: Conversation,
  target: HostContext,
): boolean {
  return (
    conversation.messages.length > 0 && conversation.workspace?.id !== target.id
  );
}
export function sameAcceptedHost(
  before: AppEnvironment,
  after: AppEnvironment,
): boolean {
  const first = currentHost(before),
    second = currentHost(after);
  return (
    !!first &&
    !!second &&
    first.id === second.id &&
    before.binding === after.binding &&
    before.connection === after.connection
  );
}
export function branchConversation(
  source: Conversation,
  target: HostContext,
): Conversation {
  const copy = structuredClone(source);
  const change: HostChange = {
    from: source.workspace?.name || source.host || "Unverified original host",
    to: target.name,
    at: Date.now(),
    messageIndex: copy.messages.length,
    parentId: source.id,
  };
  // Opaque provider reasoning from the old host must not bypass the visible boundary.
  for (const message of copy.messages) {
    delete message.responseOutput;
    delete message.responseEndpoint;
    delete message.responseModel;
  }
  return {
    ...copy,
    id: crypto.randomUUID(),
    title: `${source.title} · ${target.name}`,
    updated: Date.now(),
    workspace: target,
    host: target.name,
    partial: "",
    error: "",
    paused: "",
    hostChanges: [...(copy.hostChanges ?? []), change],
  };
}
export function hostInstructions(conversation: Conversation): string {
  if (!conversation.hostChanges?.length) return "";
  return `\nHOST CONTEXT BOUNDARIES (message indices are zero-based): ${JSON.stringify(conversation.hostChanges)}\nMessages before each boundary describe the previous host, including paths, files, OS, tool output and approvals. Treat that history as reference only. The user authorized a separate conversation on the current host, not replay of previous actions. Before remote work, discover the current workspace and its capabilities and inspect the current host. Never assume old paths, credentials, consoles, file revisions or approvals apply. Explain your plan for the current host.`;
}
