import test from "node:test";
import assert from "node:assert/strict";
import { ConversationStore } from "../../src/v3/core/conversation-store.js";
import { TurnIndex } from "../../src/v3/core/turn-index.js";
import { TimelineState, sampleRailMarkers } from "../../src/v3/core/timeline-state.js";
import { MemoryStorageAdapter } from "../../src/v3/core/storage.js";
import { PromptStore } from "../../src/v3/core/prompt-store.js";
import { TimelineCache, TIMELINE_CACHE_KEY } from "../../src/v3/core/timeline-cache.js";
import { normalizeQuestionDisplayText } from "../../src/v3/core/question-display.js";

function turns(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `q${index + 1}`, order: index, text: `Question ${index + 1}` }));
}

test("ConversationStore isolates A -> B -> A state", () => {
  let now = 1;
  const store = new ConversationStore({ clock: () => now++ });
  store.activateConversation("A", "/c/A");
  store.update("A", { turnCount: 12, activeTurnId: "a7" });
  store.activateConversation("B", "/c/B");
  store.update("B", { turnCount: 4, activeTurnId: "b2" });
  store.activateConversation("A", "/c/A");
  assert.equal(store.getActive().activeTurnId, "a7");
  assert.equal(store.get("A").turnCount, 12);
  assert.equal(store.get("B").activeTurnId, "b2");
});


test("background conversation updates never steal the active conversation", () => {
  const store = new ConversationStore();
  store.activateConversation("A", "/c/A");
  store.setCaptureStatus("B", { status: "active", turnCount: 50 });
  assert.equal(store.getActive().conversationId, "A");
  assert.equal(store.get("B").captureStatus.turnCount, 50);
});
test("TimelineState keeps conversation-scoped viewport state", () => {
  const state = new TimelineState();
  state.update("A", { panelOpen: true, manualBrowse: true, anchorTurnId: "a40", anchorOffset: 12 });
  state.update("B", { panelOpen: false, anchorTurnId: "b2" });
  assert.deepEqual(state.get("A"), { panelOpen: true, manualBrowse: true, followActive: true, anchorTurnId: "a40", anchorOffset: 12, maxRailMarkers: 14 });
  assert.equal(state.get("B").anchorTurnId, "b2");
});

test("TurnIndex keeps capture ordering when visible DOM order is partial", () => {
  let now = 100;
  const index = new TurnIndex({ clock: () => ++now });
  index.replaceCapture(turns(6).map((turn) => ({ ...turn, source: "capture" })));
  index.setVisible([
    { id: "q4", order: 0, text: "Question 4", source: "dom", visible: true },
    { id: "q5", order: 1, text: "Question 5", source: "dom", visible: true }
  ]);
  assert.deepEqual(index.getOrdered().map((turn) => turn.id), ["q1", "q2", "q3", "q4", "q5", "q6"]);
  assert.equal(index.get("q4").source, "capture+dom");
  assert.equal(index.get("q4").order, 3);
  assert.deepEqual(index.getVisible().map((turn) => turn.id), ["q4", "q5"]);
});

test("TurnIndex canonicalizes fallback-turn ids onto capture order", () => {
  const index = new TurnIndex();
  index.setVisible([
    { id: "fallback-turn-2", order: 2, text: "Question 3", source: "dom", visible: true }
  ]);
  index.replaceCapture(turns(4).map((turn) => ({ ...turn, source: "capture" })));
  assert.equal(index.size(), 4);
  assert.equal(index.resolveCanonicalId("fallback-turn-2"), "q3");
  assert.deepEqual(index.getVisible().map((turn) => turn.id), ["q3"]);
  assert.equal(index.get("fallback-turn-2").source, "capture+dom");
});
test("TurnIndex reconciles legacy turn-index records onto one visible stable DOM UUID", () => {
  const index = new TurnIndex({ clock: () => 100 });
  const stableId = "01a07940-678e-7211-adc4-3755f4faa004";
  index.mergeMany([{ id: "turn-index-0", order: 0, text: "legacy question", source: "dom", visible: false }]);
  index.setVisible([{ id: stableId, order: 0, text: "legacy question", source: "dom", visible: true }]);
  assert.equal(index.size(), 1);
  assert.equal(index.resolveCanonicalId("turn-index-0"), stableId);
  assert.deepEqual(index.getOrdered().map((turn) => turn.id), [stableId]);
  assert.equal(index.get("turn-index-0").visible, true);
});

test("TurnIndex does not reconcile legacy ids from order alone when exact text evidence differs", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "turn-index-0", order: 0, text: "legacy", source: "dom", visible: false }]);
  index.setVisible([{ id: "stable-uuid", order: 0, text: "different stable text", source: "dom", visible: true }]);
  assert.equal(index.size(), 2);
  assert.equal(index.resolveCanonicalId("turn-index-0"), "turn-index-0");
});

test("TurnIndex reindexes a fully stable UUIDv7 Local history and drops covered legacy rows", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "01a07640-7c14-7d30-975a-50d510808a83", order: 0, text: "third", source: "dom", visible: false },
    { id: "01a06bda-9662-74e1-b3bc-086042feec1d", order: 0, text: "first", source: "dom", visible: false },
    { id: "01a07036-27cd-7e03-a00d-1a3566e2ad45", order: 0, text: "same", source: "dom", visible: false },
    { id: "01a07485-d3d5-7352-b366-5ce1bd227ea9", order: 1, text: "same", source: "dom", visible: false },
    { id: "turn-index-10", order: 3, text: "third", source: "dom", visible: false },
    { id: "turn-index-6", order: 3, text: "same", source: "dom", visible: false }
  ]);
  assert.equal(index.reindexUuidV7(), true);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.id, turn.order]), [
    ["01a06bda-9662-74e1-b3bc-086042feec1d", 0],
    ["01a07036-27cd-7e03-a00d-1a3566e2ad45", 1],
    ["01a07485-d3d5-7352-b366-5ce1bd227ea9", 2],
    ["01a07640-7c14-7d30-975a-50d510808a83", 3]
  ]);
  assert.equal(index.has("turn-index-10"), true);
  assert.equal(index.get("turn-index-10").id, "01a07640-7c14-7d30-975a-50d510808a83");
  assert.equal(index.records.has("turn-index-6"), false);
});

test("TurnIndex UUIDv7 reindex fails closed while an unmatched legacy row remains", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "01a06bda-9662-74e1-b3bc-086042feec1d", order: 7, text: "stable", source: "dom", visible: false },
    { id: "turn-index-2", order: 2, text: "unmatched", source: "dom", visible: false }
  ]);
  assert.equal(index.reindexUuidV7(), false);
  assert.equal(index.get("01a06bda-9662-74e1-b3bc-086042feec1d").order, 7);
  assert.equal(index.records.has("turn-index-2"), true);
});

test("TurnIndex DOM fallback works without capture", () => {
  const index = new TurnIndex();
  index.setVisible([
    { id: "d1", order: 0, text: "one", source: "dom", visible: true },
    { id: "d2", order: 1, text: "two", source: "dom", visible: true }
  ]);
  assert.equal(index.size(), 2);
  assert.deepEqual(index.getOrdered().map((turn) => turn.id), ["d1", "d2"]);
});

test("rail sampling caps density and always includes active turn", () => {
  const all = turns(100);
  const sampled = sampleRailMarkers(all, "q57", 14);
  assert.equal(sampled.length, 14);
  assert.equal(sampled[0].id, "q1");
  assert.equal(sampled.at(-1).id, "q100");
  assert.ok(sampled.some((turn) => turn.id === "q57"));
  assert.equal(new Set(sampled.map((turn) => turn.id)).size, sampled.length);
});

test("PromptStore create/edit/favorite/search/delete persists through adapter", () => {
  let now = 1000;
  const storage = new MemoryStorageAdapter();
  const store = new PromptStore({ storage, clock: () => ++now, idFactory: () => `p${now}` });
  for (let index = 0; index < 6; index += 1) store.create({ title: `Title ${index}`, text: `Body ${index}` });
  assert.equal(store.list().length, 6);
  const item = store.list().find((entry) => entry.title === "Title 3");
  store.update(item.id, { title: "中文标题", text: "deep search needle" });
  store.toggleFavorite(item.id);
  assert.equal(store.search("needle").length, 1);
  assert.equal(store.list()[0].id, item.id);
  assert.equal(store.remove(item.id), true);
  assert.equal(store.list().length, 5);
});


test("TimelineCache persists only user-turn metadata and skips lastSeen-only rewrites", () => {
  const base = new MemoryStorageAdapter();
  let writes = 0;
  const storage = {
    read: (...args) => base.read(...args),
    write: (key, value) => { writes += 1; return base.write(key, value); },
    remove: (...args) => base.remove(...args)
  };
  const cache = new TimelineCache({ storage, clock: () => 1234 });
  const input = [{ id: "q1", order: 0, text: "Question 1", shortText: "Question 1", type: "text", source: "dom", visible: true, lastSeen: 10 }];
  assert.equal(cache.save("A", input), true);
  const stored = base.read(TIMELINE_CACHE_KEY);
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.conversations.A.turns.length, 1);
  assert.equal("visible" in stored.conversations.A.turns[0], false);
  assert.equal("source" in stored.conversations.A.turns[0], false);
  assert.deepEqual(cache.load("A").map((turn) => turn.id), ["q1"]);
  assert.equal(cache.save("A", [{ ...input[0], lastSeen: 9999 }]), false);
  assert.equal(writes, 1);
});

test("Question display normalization extracts My request without mutating source semantics", () => {
  const raw = [
    "# Selected text:",
    "",
    "## Selection 1",
    "reference noise https://example.com",
    "",
    "## My request:",
    "Analyze this behavior",
    "```js",
    "const value = 1;",
    "```"
  ].join("\n");
  assert.equal(normalizeQuestionDisplayText(raw), "Analyze this behavior [code]");
  assert.equal(normalizeQuestionDisplayText("Review [docs](https://example.com) https://noise.example"), "Review docs");
  assert.equal(normalizeQuestionDisplayText("# Selected text:\n## Selection 1\nkeep this text"), "keep this text");
  assert.match(raw, /Selected text/);
});
