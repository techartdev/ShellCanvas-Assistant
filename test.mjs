// SPDX-License-Identifier: MPL-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
async function module(path) {
  const result = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const { runAgent, completion, sseEvents, responsesInput } =
  await module("agent.ts");
const { History } = await module("history.ts");
const { memoryStorage } = await module("memory-storage.ts");
const connection = {
  endpoint: "https://fixture.invalid/chat",
  revision: "r1",
  hasKey: false,
  remembered: false,
};
function response(events, status = 200) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event) =>
          `data: ${typeof event === "string" ? event : JSON.stringify(event)}\r\n\r\n`,
      )
      .join(""),
  );
  let offset = 0,
    closed = false;
  return {
    status,
    contentType: "text/event-stream",
    async read() {
      if (offset >= bytes.length) return null;
      const result = bytes.slice(offset, offset + 7);
      offset += 7;
      return result;
    },
    async close() {
      closed = true;
    },
    get closed() {
      return closed;
    },
  };
}
const event = (delta, finish = null) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const defaults = {
  connection,
  model: "fixture",
  signal: new AbortController().signal,
  onText() {},
  onTool() {},
  onRound() {},
  tools: [],
  messages: [],
};
test("SSE preserves split Unicode and multiline data", async () => {
  const bytes = new TextEncoder().encode("data: Привет\r\ndata: world\r\n\r\n");
  async function* chunks() {
    for (const byte of bytes) yield Uint8Array.of(byte);
  }
  const events = [];
  for await (const value of sseEvents(chunks())) events.push(value);
  assert.deepEqual(events, ["Привет\nworld"]);
});
test("Responses preserves encrypted reasoning and tool IDs across a stateless tool round", async () => {
  const profile = {
    ...connection,
    endpoint: "https://fixture.invalid/v1/responses",
  };
  let rounds = 0,
    runs = 0;
  const reasoning = {
    type: "reasoning",
    id: "rs_fixture",
    summary: [],
    encrypted_content: "fixture-opaque",
  };
  const call = {
    type: "function_call",
    id: "fc_fixture",
    call_id: "call_fixture",
    name: "inspect",
    arguments: "{}",
    status: "completed",
  };
  const messages = [{ role: "user", content: "Inspect" }];
  await runAgent({
    ...defaults,
    connection: profile,
    messages,
    tools: [
      {
        name: "inspect",
        description: "inspect",
        parameters: { type: "object", properties: {} },
        run: async () => {
          runs++;
          return { ok: true };
        },
      },
    ],
    network: {
      async postJSON({ body }) {
        assert.equal(body.store, false);
        assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
        assert.equal(body.tools[0].name, "inspect");
        if (rounds++ === 0)
          return response([
            { type: "response.output_item.added", item: call },
            {
              type: "response.completed",
              response: { status: "completed", output: [reasoning, call] },
            },
          ]);
        assert.deepEqual(body.input[1], reasoning);
        assert.deepEqual(body.input[2], call);
        assert.equal(body.input[3].call_id, "call_fixture");
        assert.equal(body.input[3].type, "function_call_output");
        return response([
          { type: "response.output_text.delta", delta: "Ready" },
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Ready" }],
                },
              ],
            },
          },
        ]);
      },
    },
  });
  assert.equal(rounds, 2);
  assert.equal(runs, 1);
  assert.equal(messages.at(-1).content, "Ready");
  const changed = responsesInput(
    messages,
    "https://other.invalid/responses",
    "fixture",
  );
  assert.ok(!JSON.stringify(changed).includes("fixture-opaque"));
  assert.ok(changed.some((item) => item.type === "function_call"));
});
test("Responses incomplete and interrupted output never dispatches tools", async () => {
  const profile = {
    ...connection,
    endpoint: "https://fixture.invalid/responses",
  };
  const call = {
    type: "function_call",
    call_id: "call_fixture",
    name: "mutate",
    arguments: "{}",
  };
  for (const events of [
    [{ type: "response.output_item.done", item: call }],
    [
      {
        type: "response.incomplete",
        response: { status: "incomplete", output: [call] },
      },
    ],
    [
      {
        type: "response.completed",
        response: { status: "completed", output: [call, call] },
      },
    ],
  ]) {
    let runs = 0;
    const r = response(events);
    await assert.rejects(() =>
      runAgent({
        ...defaults,
        connection: profile,
        messages: [],
        tools: [{ name: "mutate", run: async () => runs++ }],
        network: { postJSON: async () => r },
      }),
    );
    assert.equal(runs, 0);
    assert.ok(r.closed);
  }
});
test("Responses maps text/image context and chat requests omit private protocol metadata", async () => {
  const input = responsesInput(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,fixture" },
          },
        ],
      },
    ],
    connection.endpoint,
    "fixture",
  );
  assert.equal(input[0].content[0].type, "input_text");
  assert.equal(input[0].content[1].type, "input_image");
  await completion({
    ...defaults,
    messages: [
      {
        role: "assistant",
        content: "Hi",
        responseOutput: [{ type: "reasoning", encrypted_content: "opaque" }],
        responseEndpoint: connection.endpoint,
        responseModel: "fixture",
      },
    ],
    network: {
      async postJSON({ body }) {
        assert.deepEqual(body.messages, [{ role: "assistant", content: "Hi" }]);
        return response([event({ content: "hello" }, "stop")]);
      },
    },
  });
});
test("streamed tool call executes once and supplies its result to the next model round", async () => {
  let calls = 0,
    runs = 0,
    text = "";
  const messages = [{ role: "user", content: "Inspect" }];
  const responses = [];
  const network = {
    async postJSON(options) {
      calls++;
      if (calls === 1) {
        const r = response([
          event({
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "read_file", arguments: '{"pa' },
              },
            ],
          }),
          event(
            {
              tool_calls: [
                { index: 0, function: { arguments: 'th":"/test"}' } },
              ],
            },
            "tool_calls",
          ),
          "[DONE]",
        ]);
        responses.push(r);
        return r;
      }
      assert.equal(options.body.messages.at(-1).role, "tool");
      assert.match(options.body.messages.at(-1).content, /fixture content/);
      const r = response([
        event({ content: "Found Привет" }),
        event({}, "stop"),
        "[DONE]",
      ]);
      responses.push(r);
      return r;
    },
  };
  await runAgent({
    ...defaults,
    network,
    messages,
    onText(value) {
      text = value;
    },
    tools: [
      {
        name: "read_file",
        description: "read",
        parameters: {},
        async run(args) {
          runs++;
          assert.equal(args.path, "/test");
          return { content: "fixture content" };
        },
      },
    ],
  });
  assert.equal(calls, 2);
  assert.equal(runs, 1);
  assert.equal(text, "Found Привет");
  assert.equal(messages.at(-1).role, "assistant");
  assert.ok(responses.every((value) => value.closed));
});
test("interrupted or malformed model streams never execute proposed tools", async () => {
  for (const events of [
    [
      event({
        tool_calls: [
          { index: 0, id: "c", function: { name: "mutate", arguments: "{}" } },
        ],
      }),
    ],
    ["not JSON"],
    [event({ content: "partial" }, "length")],
  ]) {
    let runs = 0;
    const r = response(events);
    await assert.rejects(() =>
      runAgent({
        ...defaults,
        network: { postJSON: async () => r },
        messages: [],
        tools: [{ name: "mutate", run: async () => runs++ }],
      }),
    );
    assert.equal(runs, 0);
    assert.equal(r.closed, true);
  }
});
test("cancel preserves completed tool results and closes the stream", async () => {
  const controller = new AbortController();
  let runs = 0;
  const messages = [];
  const r = response([
    event(
      {
        tool_calls: [
          { index: 0, id: "one", function: { name: "task", arguments: "{}" } },
          { index: 1, id: "two", function: { name: "task", arguments: "{}" } },
        ],
      },
      "tool_calls",
    ),
    "[DONE]",
  ]);
  await assert.rejects(() =>
    runAgent({
      ...defaults,
      signal: controller.signal,
      network: { postJSON: async () => r },
      messages,
      tools: [
        {
          name: "task",
          run: async () => {
            runs++;
            controller.abort();
            return { done: true };
          },
        },
      ],
    }),
  );
  assert.equal(runs, 1);
  assert.equal(messages.filter((m) => m.role === "tool").length, 2);
  assert.match(messages.at(-1).content, /canceled/);
  assert.equal(r.closed, true);
});
test("history chunks large attachments and rejects another window's stale save without losing its version", async () => {
  const storage = memoryStorage(),
    history = new History(storage);
  const chat = {
    version: 1,
    id: "test-id",
    title: "A conversation",
    updated: 1,
    messages: [{ role: "user", content: "hello" }],
    draft: "draft",
    attachments: [
      {
        id: "image",
        kind: "image",
        name: "image",
        content: "a".repeat(800000),
      },
    ],
    host: "fixture",
  };
  const first = await history.save(chat, null);
  const loaded = await history.load(chat.id);
  assert.deepEqual(loaded.conversation, chat);
  assert.equal((await history.list()).length, 1);
  const changed = { ...chat, draft: "new draft", updated: 2 };
  await history.save(changed, first);
  await assert.rejects(() => history.save({ ...chat, draft: "stale" }, first));
  assert.equal((await history.load(chat.id)).conversation.draft, "new draft");
  await history.remove(chat.id);
  assert.equal((await history.list()).length, 0);
});
