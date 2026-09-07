import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorageAdapter } from "../src/core/storage-adapter.js";
import { PromptStore } from "../src/core/prompt-store.js";

test("PromptStore persists a versioned schema and supports CRUD/favorite", () => {
  let now = 1000;
  let sequence = 0;
  const storage = new MemoryStorageAdapter();
  const store = new PromptStore({
    storage,
    clock: () => now,
    idFactory: () => `p-${++sequence}`
  });

  const first = store.create({ name: "  Summarize ", content: "Summarize this text." });
  now = 2000;
  const second = store.create({ name: "Translate", content: "Translate to Japanese.", favorite: true });
  assert.deepEqual(store.search("summ"), [first]);
  assert.equal(store.toggleFavorite(first.id).favorite, true);
  assert.equal(store.update(first.id, { content: "Summarize with bullets." }).content, "Summarize with bullets.");
  assert.equal(store.delete(second.id), true);

  const persisted = JSON.parse(storage.get("gpt-talk-enhancer.prompts.v1"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.items.length, 1);
  assert.equal(persisted.items[0].name, "Summarize");
  assert.equal(persisted.items[0].favorite, true);
});

test("PromptStore ignores malformed or wrong-version data", () => {
  const storage = new MemoryStorageAdapter({
    "gpt-talk-enhancer.prompts.v1": JSON.stringify({ version: 99, items: [{ id: "bad" }] })
  });
  const store = new PromptStore({ storage });
  assert.deepEqual(store.load(), []);
});

test("PromptStore keeps explicit order stable for search results", () => {
  const storage = new MemoryStorageAdapter();
  const store = new PromptStore({ storage, idFactory: (() => { let i = 0; return () => `p-${++i}`; })() });
  const first = store.create({ name: "First", content: "same" });
  const second = store.create({ name: "Second", content: "same" });
  store.update(second.id, { order: 0 });
  assert.deepEqual(store.search("same").map((item) => item.name), ["First", "Second"]);
  assert.equal(first.order, 0);
});
