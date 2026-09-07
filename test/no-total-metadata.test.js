import test from "node:test";
import assert from "node:assert/strict";
import { runVirtualizationSpike } from "../src/core/virtualization-spike.js";
import { TurnRegistry } from "../src/core/turn-registry.js";

test("no-total-metadata virtualization stays progressive without a false completion", async () => {
  const turnCount = 120;
  const clientHeight = 500;
  const scrollHeight = turnCount * 100;
  const maxLogicalPosition = scrollHeight - clientHeight;
  let logicalPosition = maxLogicalPosition;
  const scrollContainer = { scrollTop: 0 };
  const editor = { innerText: "preserve composer", focus() {} };
  const documentRef = { activeElement: editor };
  const windowRef = { setTimeout(callback) { callback(); } };
  const observedWindows = [];
  const adapter = {
    getScrollBounds() {
      return {
        scrollTop: logicalPosition - maxLogicalPosition,
        scrollHeight,
        clientHeight,
        flexDirection: "column-reverse",
        isColumnReverse: true,
        logicalPosition,
        minLogicalPosition: 0,
        maxLogicalPosition,
        minScrollTop: -maxLogicalPosition,
        maxScrollTop: 0
      };
    },
    getLogicalScrollPosition() {
      return logicalPosition;
    },
    setLogicalScrollPosition(position) {
      logicalPosition = Math.max(0, Math.min(maxLogicalPosition, position));
      scrollContainer.scrollTop = logicalPosition - maxLogicalPosition;
      return logicalPosition;
    },
    getRenderedUserTurns() {
      const center = Math.floor(logicalPosition / 100);
      const start = Math.max(0, Math.min(turnCount - 10, center - 4));
      const turns = Array.from({ length: 10 }, (_value, offset) => {
        const index = start + offset;
        return {
          key: `turn-${index}`,
          text: `Question ${index + 1}`,
          logicalOrder: index,
          approximatePosition: index * 100,
          element: { key: `turn-${index}` },
          metadata: {}
        };
      });
      observedWindows.push(turns);
      return turns;
    }
  };

  const result = await runVirtualizationSpike({
    adapter,
    root: {},
    scrollContainer,
    editor,
    document: documentRef,
    window: windowRef,
    maxSteps: 256,
    settleMs: 0
  });

  assert.equal(result.pass, false);
  assert.equal(result.mode, "progressive");
  assert.equal(result.evidence.discoveredUserTurnCount, turnCount);
  assert.equal(result.evidence.declaredSize, null);
  assert.equal(result.evidence.flexDirection, "column-reverse");
  assert.equal(result.evidence.reachedStart, true);
  assert.equal(result.evidence.reachedEnd, true);
  assert.equal(result.evidence.restoreDelta, 0);
  assert.equal(result.evidence.composerPreserved, true);
  assert.ok(result.failureReasons.includes("no-reliable-total-turn-metadata"));

  const registry = new TurnRegistry();
  registry.setConversation("no-total-metadata");
  for (const window of observedWindows) registry.syncRendered(window);
  assert.equal(registry.size, turnCount);
});
