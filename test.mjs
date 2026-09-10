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
const { workspaceTools } = await module("tools.ts");
const serviceNames = [
  "system.files.listStart",
  "system.files.readText",
  "system.files.saveText",
  "system.files.createText",
  "system.console.open",
];
function workspaceFixture() {
  let environment = {
    connection: "connected",
    binding: "fixture-binding",
    host: { name: "Fixture", system: "synthetic" },
  };
  const writes = [];
  let readCount = 0;
  const doc = {
    path: "/fixture/test.txt",
    name: "test.txt",
    text: "before",
    revision: "read-revision",
    binding: "fixture-binding",
    writable: true,
  };
  const client = {
    environment: { get: async () => environment },
    services: {
      list: async () =>
        serviceNames.map((name) => ({ name, available: true, granted: true })),
    },
    files: {
      readText: async () => {
        readCount++;
        return doc;
      },
      saveText: async (retained, text) => {
        writes.push({ retained, text });
        return { ...retained, text, revision: "saved-revision" };
      },
      createText: async (args) => {
        writes.push(args);
        return { path: "/fixture/new.txt" };
      },
    },
  };
  return {
    client,
    doc,
    writes,
    get readCount() {
      return readCount;
    },
    change() {
      environment = { ...environment, binding: "replacement-binding" };
    },
  };
}
test("tools require a retained read revision and reject declines and binding changes during review", async () => {
  for (const mode of ["allow", "decline", "reconnect"]) {
    const fixture = workspaceFixture();
    let reviews = 0;
    const kit = await workspaceTools(
      fixture.client,
      await fixture.client.environment.get(),
      async (action) => {
        reviews++;
        assert.match(action.detail, /before/);
        assert.equal(action.target, "Fixture");
        if (mode === "reconnect") fixture.change();
        return mode !== "decline";
      },
    );
    const get = (name) => kit.tools.find((t) => t.name === name);
    const signal = new AbortController().signal;
    await assert.rejects(
      () =>
        get("edit_text_file").run(
          { path: fixture.doc.path, text: "after" },
          signal,
        ),
      /Read the file/,
    );
    await get("read_text_file").run({ path: fixture.doc.path }, signal);
    if (mode === "allow") {
      await get("edit_text_file").run(
        { path: fixture.doc.path, text: "after" },
        signal,
      );
      assert.equal(fixture.writes[0].retained.revision, "read-revision");
    } else {
      await assert.rejects(() =>
        get("edit_text_file").run(
          { path: fixture.doc.path, text: "after" },
          signal,
        ),
      );
      assert.equal(fixture.writes.length, 0);
    }
    assert.equal(reviews, 1);
    assert.equal(fixture.readCount, 1);
    await kit.close();
  }
});
test("unsupported and denied capabilities produce no remote tools", async () => {
  const client = {
    environment: { get: async () => ({ connection: "local" }) },
    services: {
      list: async () =>
        serviceNames.map((name, i) => ({
          name,
          available: i % 2 === 0,
          granted: i % 2 !== 0,
        })),
    },
  };
  const kit = await workspaceTools(
    client,
    { connection: "local" },
    async () => {
      throw new Error("Unexpected review");
    },
  );
  assert.deepEqual(
    kit.tools.map((t) => t.name),
    ["workspace_info"],
  );
  await kit.close();
});
test("console tool decodes UTF-8 split across reads and closes its owned session", async () => {
  const fixture = workspaceFixture();
  const bytes = new TextEncoder().encode("€");
  let read = 0,
    closed = 0;
  fixture.client.console = {
    open: async () => ({
      write: async () => {},
      read: async () =>
        read++ === 0 ? bytes.slice(0, 1) : read === 2 ? bytes.slice(1) : null,
      close: async () => {
        closed++;
      },
    }),
  };
  const kit = await workspaceTools(
    fixture.client,
    await fixture.client.environment.get(),
    async () => true,
  );
  const get = (name) => kit.tools.find((t) => t.name === name);
  const signal = new AbortController().signal;
  await get("console_send").run({ text: "fixture\n" }, signal);
  assert.equal((await get("console_read").run({}, signal)).output, "€");
  assert.equal((await get("console_read").run({}, signal)).eof, true);
  await kit.close();
  assert.equal(closed, 1);
});

const { runLimits, activeDeadline, RunPaused } = await module("run-budget.ts");
const { ConsoleOutput } = await module("console-output.ts");
function workingModel(finishAfter) {
  let count = 0;
  return {
    get count() {
      return count;
    },
    async postJSON() {
      count++;
      return response(
        count > finishAfter
          ? [event({ content: "Verified and done." }, "stop")]
          : [
              event(
                {
                  tool_calls: [
                    {
                      index: 0,
                      id: `work-${count}`,
                      function: { name: "inspect", arguments: "{}" },
                    },
                  ],
                },
                "tool_calls",
              ),
            ],
      );
    },
  };
}
test("default runs pass the old 12-round and 20-tool caps and pause at 30 with paired results", async () => {
  const network = workingModel(100),
    messages = [];
  let runs = 0;
  await assert.rejects(
    runAgent({
      ...defaults,
      network,
      messages,
      tools: [{ name: "inspect", run: async () => ({ completed: ++runs }) }],
    }),
    /Paused after 30/,
  );
  assert.equal(network.count, 30);
  assert.equal(runs, 30);
  assert.equal(messages.filter((m) => m.role === "tool").length, 30);
  assert.equal(messages.at(-1).tool_call_id, "work-30");
  // Continuing consumes the saved results; it never replays completed tool calls.
  const continuation = workingModel(0);
  await runAgent({
    ...defaults,
    network: continuation,
    messages,
    tools: [
      {
        name: "inspect",
        run: async () => {
          throw new Error("replayed");
        },
      },
    ],
  });
  assert.equal(messages.at(-1).content, "Verified and done.");
});
test("user round budget permits a 41-round task and has no product ceiling", async () => {
  assert.equal(runLimits().rounds, 30);
  assert.equal(runLimits({ rounds: 100000 }).rounds, 100000);
  for (const rounds of [0, -1, 1.5, NaN, Infinity, "40"])
    assert.equal(runLimits({ rounds }).rounds, 30);
  const network = workingModel(40);
  await runAgent({
    ...defaults,
    network,
    messages: [],
    limits: { rounds: 60 },
    tools: [{ name: "inspect", run: async () => ({ ok: true }) }],
  });
  assert.equal(network.count, 41);
});
test("context growth is checked before each new request", async () => {
  const network = workingModel(10);
  const messages = [{ role: "user", content: "x".repeat(2500000) }];
  await assert.rejects(
    runAgent({
      ...defaults,
      network,
      messages,
      tools: [{ name: "inspect", run: async () => "x".repeat(150000) }],
    }),
    /too large/,
  );
  assert.equal(network.count, 1);
  assert.equal(messages.at(-1).role, "tool");
});
test("approval time is excluded, resumed work expires, and closed timers stay closed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const controller = new AbortController();
  const deadline = activeDeadline(controller, 1000);
  now = 300;
  t.mock.timers.tick(300);
  deadline.pause();
  now += 100000;
  t.mock.timers.tick(100000);
  assert.equal(controller.signal.aborted, false);
  deadline.resume();
  now += 699;
  t.mock.timers.tick(699);
  assert.equal(controller.signal.aborted, false);
  now++;
  t.mock.timers.tick(1);
  assert.ok(controller.signal.reason instanceof RunPaused);
  deadline.close();
  const second = new AbortController(),
    closed = activeDeadline(second, 100);
  closed.pause();
  closed.close();
  closed.resume();
  t.mock.timers.tick(10000);
  assert.equal(second.signal.aborted, false);
});
test("Stop during approval remains effective", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController(),
    deadline = activeDeadline(controller, 1000);
  deadline.pause();
  controller.abort(new Error("Stopped by you."));
  assert.equal(controller.signal.aborted, true);
  deadline.close();
});
test("console batches chunks and keeps an idle pending read without duplication or data loss", async () => {
  let reads = 0,
    release;
  const reader = new ConsoleOutput(async () => {
    reads++;
    if (reads === 1) return new TextEncoder().encode("first");
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const signal = new AbortController().signal;
  assert.equal((await reader.collect(signal, 2, 2)).output, "first");
  assert.equal((await reader.collect(signal, 2, 2)).waiting, true);
  assert.equal(reads, 2);
  release(new TextEncoder().encode("next"));
  assert.equal((await reader.collect(signal, 2, 2)).output, "next");
  assert.equal(reads, 3);
  release(null);
  assert.equal((await reader.collect(signal, 2, 2)).eof, true);
});
test("cancel interrupts a pending console read promptly", async () => {
  const controller = new AbortController();
  const reader = new ConsoleOutput(async () => new Promise(() => {}));
  const pending = reader.collect(controller.signal);
  controller.abort(new Error("stop fixture"));
  await assert.rejects(pending, /stop fixture/);
});

const {
  currentHost,
  needsHostChoice,
  sameAcceptedHost,
  branchConversation,
  hostInstructions,
} = await module("host-context.ts");
const envA = {
  connection: "connected",
  binding: "lease-a",
  workspaceId: "host-a",
  host: { name: "Same name" },
};
const envB = { ...envA, binding: "lease-b", workspaceId: "host-b" };
const sourceChat = {
  version: 1,
  id: "original",
  title: "Task",
  updated: 1,
  host: "Same name",
  workspace: currentHost(envA),
  draft: "Unsent draft",
  attachments: [
    { id: "a", name: "note", kind: "text", content: "draft attachment" },
  ],
  messages: [
    { role: "user", content: "Inspect host A" },
    {
      role: "assistant",
      content: "Result from A",
      responseOutput: [{ type: "reasoning", encrypted_content: "opaque" }],
      responseEndpoint: "endpoint",
      responseModel: "model",
    },
  ],
  paused: "Paused",
  partial: "Unfinished",
};
test("conversation identity survives reconnect and rename, rejects duplicate labels, legacy chats and missing identity", () => {
  assert.equal(
    needsHostChoice(
      sourceChat,
      currentHost({ ...envA, binding: "new-lease", host: { name: "Renamed" } }),
    ),
    false,
  );
  assert.equal(needsHostChoice(sourceChat, currentHost(envB)), true);
  assert.equal(
    needsHostChoice({ ...sourceChat, workspace: undefined }, currentHost(envA)),
    true,
  );
  assert.equal(
    needsHostChoice({ ...sourceChat, messages: [] }, currentHost(envB)),
    false,
  );
  for (const env of [
    { connection: "local" },
    { ...envA, connection: "disconnected" },
    { ...envA, connection: "review-required" },
  ])
    assert.equal(currentHost(env), null);
  assert.equal(
    currentHost({ connection: "local", workspaceId: "local" }).id,
    "local",
  );
  assert.equal(sameAcceptedHost(envA, envB), false);
  assert.equal(
    sameAcceptedHost(envA, { ...envA, binding: "replacement" }),
    false,
  );
});
test("host continuation preserves original, clears opaque reasoning, records boundary and persists ownership", async () => {
  const original = structuredClone(sourceChat);
  const branch = branchConversation(sourceChat, currentHost(envB));
  assert.deepEqual(sourceChat, original);
  assert.notEqual(branch.id, sourceChat.id);
  assert.equal(branch.workspace.id, "host-b");
  assert.equal(branch.messages[1].content, "Result from A");
  assert.equal(branch.messages[1].responseOutput, undefined);
  assert.equal(branch.draft, sourceChat.draft);
  assert.equal(branch.partial, "");
  assert.equal(branch.paused, "");
  assert.equal(branch.hostChanges[0].messageIndex, 2);
  assert.equal(branch.hostChanges[0].parentId, sourceChat.id);
  assert.match(hostInstructions(branch), /Never assume old paths/);
  const history = new History(memoryStorage());
  await history.save(sourceChat, null);
  await history.save(branch, null);
  assert.deepEqual((await history.load(sourceChat.id)).conversation, original);
  assert.deepEqual((await history.load(branch.id)).conversation, branch);
});

test("host labels include destinations and legacy warnings do not assert a known original target", async () => {
  const { currentHost, hostChoiceMessage } = await module("host-context.ts");
  const target = currentHost({
    ...envA,
    host: { name: "Mac", target: "user@mac.example:22" },
  });
  assert.equal(target.name, "Mac · user@mac.example:22");
  const legacy = hostChoiceMessage(
    { ...sourceChat, workspace: undefined, host: "SSH host" },
    target,
  );
  assert.match(legacy, /cannot verify/i);
  assert.match(legacy, /Mac · user@mac.example:22/);
  assert.doesNotMatch(legacy, /conversation belongs to/);
  assert.match(
    hostChoiceMessage(sourceChat, target),
    /conversation belongs to/,
  );
});
