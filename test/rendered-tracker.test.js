import test from "node:test";
import assert from "node:assert/strict";
import { RenderedTracker } from "../src/core/rendered-tracker.js";
import { TurnRegistry } from "../src/core/turn-registry.js";

test("RenderedTracker does not rebuild the Timeline for identical User Turns", () => {
  const registry = new TurnRegistry({ clock: () => 1 });
  registry.setConversation("fixture");
  let current = [{ key: "turn-1", text: "same", logicalOrder: 0, element: { version: 1 } }];
  let changes = 0;
  const tracker = new RenderedTracker({
    adapter: { getRenderedUserTurns: () => current },
    registry,
    onChange: () => { changes += 1; },
    clock: () => 1
  });
  tracker.bind({}, {});
  current = [{ key: "turn-1", text: "same", logicalOrder: 0, element: { version: 2 } }];
  tracker.refresh("assistant-stream");
  assert.equal(changes, 1);
  assert.equal(tracker.status().refreshCount, 2);
  assert.equal(tracker.status().changeCount, 1);
});

test("RenderedTracker reports a new User Turn as a Timeline change", () => {
  const registry = new TurnRegistry({ clock: () => 1 });
  registry.setConversation("fixture");
  let current = [{ key: "turn-1", text: "one", logicalOrder: 0, element: {} }];
  let changes = 0;
  const tracker = new RenderedTracker({
    adapter: { getRenderedUserTurns: () => current },
    registry,
    onChange: () => { changes += 1; },
    clock: () => 1
  });
  tracker.bind({}, {});
  current = [
    { key: "turn-1", text: "one", logicalOrder: 0, element: {} },
    { key: "turn-2", text: "two", logicalOrder: 1, element: {} }
  ];
  tracker.refresh("new-user-turn");
  assert.equal(changes, 2);
  assert.equal(registry.size, 2);
});
