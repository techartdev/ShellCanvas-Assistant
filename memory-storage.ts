// SPDX-License-Identifier: MPL-2.0
import type { AppStorageAPI, AppValue } from "@shellcanvas/app-sdk";
/** Explicit session-only fallback when an installation lacks the storage grant. */
export function memoryStorage(): AppStorageAPI {
  const values = new Map<string, AppValue>();
  return {
    async get(key) {
      return structuredClone(values.get(key) ?? null);
    },
    async put(key, value, revision) {
      if ((values.get(key)?.revision ?? null) !== revision)
        throw new Error(
          "Conversation changed in another window. Save a copy to preserve this draft.",
        );
      const next = {
        revision: crypto.randomUUID(),
        value: structuredClone(value),
      };
      values.set(key, next);
      return structuredClone(next);
    },
    async remove(key, revision) {
      if ((values.get(key)?.revision ?? null) !== revision)
        throw new Error("Storage changed.");
      values.delete(key);
    },
    async list(options = {}) {
      const keys = [...values.keys()]
        .filter((key) => !options.after || key > options.after)
        .sort();
      const selected = keys.slice(0, options.limit ?? 100);
      return {
        keys: selected,
        next: keys.length > selected.length ? selected.at(-1)! : null,
      };
    },
  };
}
