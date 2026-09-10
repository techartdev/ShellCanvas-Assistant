// SPDX-License-Identifier: MPL-2.0
import type { AppStorageAPI, AppValue, Json } from "@shellcanvas/app-sdk";
import type { HostContext, HostChange } from "./host-context";
import type { Message } from "./agent";
export interface Attachment {
  id: string;
  name: string;
  kind: "text" | "image";
  content: string;
}
export interface Conversation {
  version: 1;
  id: string;
  title: string;
  updated: number;
  messages: Message[];
  draft: string;
  attachments: Attachment[];
  host: string;
  workspace?: HostContext;
  hostChanges?: HostChange[];
  partial?: string;
  error?: string;
  paused?: string;
}
interface Header {
  version: 1;
  title: string;
  updated: number;
  parts: string[];
}
export class History {
  constructor(private storage: AppStorageAPI) {}
  async list() {
    const records: { id: string; title: string; updated: number }[] = [];
    let after: string | undefined;
    do {
      const page = await this.storage.list({ after, limit: 200 });
      for (const key of page.keys.filter((key) => key.startsWith("chat-"))) {
        const value = await this.storage.get(key);
        const header = value?.value as unknown as Header;
        if (
          header?.version === 1 &&
          typeof header.title === "string" &&
          Array.isArray(header.parts)
        )
          records.push({
            id: key.slice(5),
            title: header.title,
            updated: header.updated,
          });
      }
      after = page.next ?? undefined;
    } while (after);
    return records.sort((a, b) => b.updated - a.updated);
  }
  async load(
    id: string,
  ): Promise<{ conversation: Conversation; record: AppValue }> {
    const record = await this.storage.get(`chat-${id}`);
    if (!record) throw new Error("This conversation is no longer available.");
    const header = record.value as unknown as Header;
    if (
      header.version !== 1 ||
      !Array.isArray(header.parts) ||
      header.parts.length > 128
    )
      throw new Error("Unsupported conversation format.");
    let raw = "";
    for (const key of header.parts) {
      if (!key.startsWith(`part-${id}-`))
        throw new Error("Invalid conversation part.");
      const part = await this.storage.get(key);
      if (typeof part?.value !== "string")
        throw new Error("A conversation part is missing.");
      raw += part.value;
    }
    const conversation: Conversation = JSON.parse(raw);
    if (
      conversation.version !== 1 ||
      conversation.id !== id ||
      !Array.isArray(conversation.messages) ||
      !Array.isArray(conversation.attachments) ||
      typeof conversation.draft !== "string"
    )
      throw new Error("Invalid saved conversation.");
    return { conversation, record };
  }
  async save(
    conversation: Conversation,
    previous: AppValue | null,
  ): Promise<AppValue> {
    const raw = JSON.stringify(conversation);
    if (raw.length > 24 * 1024 * 1024)
      throw new Error(
        "This conversation reached 24 MiB. Export it and begin a new one.",
      );
    const generation = crypto.randomUUID();
    const parts: string[] = [];
    try {
      for (let offset = 0; offset < raw.length; offset += 240000) {
        const key = `part-${conversation.id}-${generation}-${parts.length}`;
        await this.storage.put(key, raw.slice(offset, offset + 240000), null);
        parts.push(key);
      }
      const record = await this.storage.put(
        `chat-${conversation.id}`,
        {
          version: 1,
          title: conversation.title,
          updated: conversation.updated,
          parts,
        } as unknown as Json,
        previous?.revision ?? null,
      );
      const old = previous?.value as unknown as Header | undefined;
      await this.removeParts(old?.parts ?? []);
      return record;
    } catch (error) {
      await this.removeParts(parts);
      throw error;
    }
  }
  private async removeParts(keys: string[]) {
    for (const key of keys) {
      try {
        const part = await this.storage.get(key);
        if (part) await this.storage.remove(key, part.revision);
      } catch {
        /* An old unreferenced part may be reclaimed later; never undo the new header. */
      }
    }
  }
  async remove(id: string) {
    const record = await this.storage.get(`chat-${id}`);
    if (!record) return;
    await this.storage.remove(`chat-${id}`, record.revision);
    const header = record.value as unknown as Header;
    await this.removeParts(header.parts);
  }
}
