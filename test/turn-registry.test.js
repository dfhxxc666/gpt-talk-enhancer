import test from "node:test";
import assert from "node:assert/strict";
import { TurnRegistry } from "../src/core/turn-registry.js";

test("TurnRegistry retains metadata after a turn leaves the virtual window", () => {
  let now = 100;
  const registry = new TurnRegistry({ clock: () => now });
  registry.setConversation("conversation-a");
  registry.syncRendered([
    { key: "turn-1", text: "First", logicalOrder: 0, approximatePosition: 0, element: { id: 1 } },
    { key: "turn-2", text: "Second", logicalOrder: 1, approximatePosition: 320, element: { id: 2 } }
  ]);
  now = 200;
  registry.syncRendered([
    { key: "turn-2", text: "Second", logicalOrder: 1, approximatePosition: 320, element: { id: 22 } },
    { key: "turn-3", text: "Third", logicalOrder: 2, approximatePosition: 640, element: { id: 3 } }
  ]);

  const first = registry.get("turn-1");
  assert.equal(first.rendered, false);
  assert.equal(first.element, null);
  assert.equal(first.text, "First");
  assert.equal(first.approximatePosition, 0);
  assert.deepEqual(registry.getAll().map((record) => record.key), ["turn-1", "turn-2", "turn-3"]);
});

test("changing conversation identity clears the registry", () => {
  const registry = new TurnRegistry();
  assert.equal(registry.setConversation("a"), true);
  registry.upsert({ key: "a-1", text: "A" });
  assert.equal(registry.setConversation("a"), false);
  assert.equal(registry.setConversation("b"), true);
  assert.equal(registry.size, 0);
});
