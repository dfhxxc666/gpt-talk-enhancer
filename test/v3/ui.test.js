import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QuestionListPanel } from "../../src/v3/ui/timeline/question-list.js";
import { TimelineRail } from "../../src/v3/ui/timeline/timeline-rail.js";
import { PromptTrigger } from "../../src/v3/ui/prompt/prompt-trigger.js";
import { PromptPanel } from "../../src/v3/ui/prompt/prompt-panel.js";
import { AppShell } from "../../src/v3/ui/app-shell.js";
import { Toast } from "../../src/v3/ui/toast.js";
import { SURFACE } from "../../src/v3/host/host-interface.js";
import { MemoryStorageAdapter } from "../../src/v3/core/storage.js";
import { PromptStore } from "../../src/v3/core/prompt-store.js";
import { FakeDocument, FakeElement, fakeWindow } from "./fake-dom.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const makeTurns = (count) => Array.from({ length: count }, (_, i) => ({ id: `q${i + 1}`, order: i, text: `这是第 ${i + 1} 个非常长的中文问题，不应该由 JavaScript 提前截断` }));

test("Question List renders Qxx rows and active updates do not rerender", () => {
  const document = new FakeDocument();
  const root = new FakeElement();
  const panel = new QuestionListPanel({ document });
  panel.mount(root);
  panel.setTurns(makeTurns(20));
  assert.equal(panel.renderCount, 1);
  assert.equal(panel.list.children[0].children[0].textContent, "Q1");
  assert.match(panel.list.children[0].children[1].textContent, /不应该由 JavaScript 提前截断/);
  panel.setActive("q17");
  panel.setActive("q18");
  assert.equal(panel.renderCount, 1);
  assert.equal(panel.findRow("q18").classList.contains("is-active"), true);
});

test("Question List pending target is distinct from verified active state", () => {
  const panel = new QuestionListPanel({ document: new FakeDocument() });
  panel.mount(new FakeElement());
  panel.setTurns(makeTurns(20));
  panel.setActive("q10");
  panel.setPending("q17");
  assert.equal(panel.findRow("q10").classList.contains("is-active"), true);
  assert.equal(panel.findRow("q17").classList.contains("is-pending"), true);
  assert.equal(panel.findRow("q17").classList.contains("is-active"), false);
});

test("Question List displays normalized request text while preserving the raw turn", () => {
  const document = new FakeDocument();
  const panel = new QuestionListPanel({ document });
  panel.mount(new FakeElement());
  const raw = ["# Selected text:", "## Selection 1", "noise", "## My request:", "Fix the navigation cache"].join("\n");
  const turn = { id: "q1", order: 0, text: raw };
  panel.setTurns([turn]);
  assert.equal(panel.list.children[0].children[1].textContent, "Fix the navigation cache");
  assert.equal(turn.text, raw);
});

test("Question List manual browse survives navigation and structural new-turn update", () => {
  const document = new FakeDocument();
  const root = new FakeElement();
  let clicked = null;
  const panel = new QuestionListPanel({ document, onSelect: (id) => { clicked = id; } });
  panel.mount(root);
  panel.setTurns(makeTurns(50));
  panel.setActive("q20");
  panel.setOpen(true);
  panel.list.scrollTop = 39 * 34;
  panel.list.fire("scroll");
  const before = panel.list.scrollTop;
  panel.findRow("q43").fire("click");
  panel.setActive("q43");
  assert.equal(clicked, "q43");
  assert.equal(panel.list.scrollTop, before);
  panel.setTurns(makeTurns(51));
  assert.equal(panel.list.scrollTop, before);
  assert.equal(panel.renderCount, 2);
});

test("Question List view state is conversation-restorable", () => {
  const document = new FakeDocument();
  const panel = new QuestionListPanel({ document });
  panel.mount(new FakeElement());
  panel.setTurns(makeTurns(50));
  panel.setOpen(true);
  panel.list.scrollTop = 39 * 34;
  panel.list.fire("scroll");
  const state = panel.getViewState();
  panel.list.scrollTop = 0;
  panel.restoreViewState(state);
  assert.equal(panel.opened, true);
  assert.equal(panel.manualBrowse, true);
  assert.equal(panel.list.scrollTop, 39 * 34);
});

test("Timeline CSS uses native single-line ellipsis", () => {
  const css = fs.readFileSync(path.join(projectRoot, "src/v3/ui/timeline/timeline.css"), "utf8");
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.gte-rail-markers\s*\{[\s\S]*?margin-top:\s*6px/);
});

test("Rail stays sparse and active marker owns exact turn id", () => {
  const document = new FakeDocument();
  const root = new FakeElement();
  let selected = null;
  const rail = new TimelineRail({ document, onSelect: (id) => { selected = id; }, maxMarkers: 14 });
  rail.mount(root);
  rail.setState(makeTurns(100), "q57");
  assert.equal(rail.markers.children.length, 14);
  const active = rail.markers.children.find((node) => node.classList.contains("is-active"));
  assert.equal(active.dataset.turnId, "q57");
  active.fire("click");
  assert.equal(selected, "q57");
});

test("Timeline rail marks pending separately from active", () => {
  const rail = new TimelineRail({ document: new FakeDocument(), maxMarkers: 14 });
  rail.mount(new FakeElement());
  rail.setState(makeTurns(100), "q1");
  rail.setPending("q100");
  assert.equal(rail.findMarker("q1").classList.contains("is-active"), true);
  assert.equal(rail.findMarker("q100").classList.contains("is-pending"), true);
  assert.equal(rail.findMarker("q100").classList.contains("is-active"), false);
});

test("Timeline rail accepts a dynamic right inset while preserving the 10px fallback", () => {
  const document = new FakeDocument();
  const rail = new TimelineRail({ document });
  rail.mount(new FakeElement());
  assert.equal(rail.element.style.right, "10px");
  assert.equal(rail.setRightInset(410.4), 410);
  assert.equal(rail.element.style.right, "410px");
  assert.equal(rail.setRightInset(-20), 10);
  assert.equal(rail.element.style.right, "10px");
});

test("AppShell keeps Timeline inside the conversation viewport and follows pane resize", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.innerWidth = 1200;
  const viewport = new FakeElement();
  viewport.rect = { left: 240, top: 40, right: 800, bottom: 860, width: 560, height: 820 };
  const host = {
    getConversationViewportElement: () => viewport,
    getConversationViewportRect: () => viewport.getBoundingClientRect()
  };
  const shell = new AppShell({ document, window, host });
  let inset = null;
  let toastCenter = null;
  let panelUpdates = 0;
  shell.rail = { setRightInset: (value) => { inset = Math.round(value); } };
  shell.toast = { setViewportRect: (rect) => { toastCenter = Math.round((rect.left + rect.right) / 2); } };
  shell.questionList = { updatePosition: () => { panelUpdates += 1; } };
  assert.equal(shell.refreshTimelineLayout(), 410);
  assert.equal(inset, 410);
  assert.equal(toastCenter, 520);
  assert.equal(shell.timelineLayoutObserver.observed[0], viewport);

  viewport.rect = { ...viewport.rect, right: 960, width: 720 };
  shell.timelineLayoutObserver.callback();
  assert.equal(inset, 250);
  assert.equal(toastCenter, 600);
  assert.equal(panelUpdates, 2);
});
test("Toast centers on the conversation viewport instead of the full window", () => {
  const document = new FakeDocument();
  const toast = new Toast({ document, window: fakeWindow(document) });
  toast.mount(new FakeElement());
  assert.equal(toast.setViewportRect({ left: 240, right: 1328 }, 1328), 784);
  assert.equal(toast.element.style.left, "784px");
  assert.equal(toast.setViewportRect(null, 1328), null);
  assert.equal(toast.element.style.left, "50%");
});
test("AppShell delays navigation text while applying pending target immediately", () => {
  const shell = new AppShell({});
  const pending = [];
  const toastCalls = [];
  shell.questionList = { setPending: (id) => pending.push(["list", id]) };
  shell.rail = { setPending: (id) => pending.push(["rail", id]) };
  shell.toast = {
    show: (message, timeout) => toastCalls.push(["show", message, timeout]),
    hide: () => toastCalls.push(["hide"])
  };
  shell.setNavigationState({ state: "pending", target: "q20", targetOrder: 19, pendingVisible: false });
  assert.deepEqual(pending, [["list", "q20"], ["rail", "q20"]]);
  assert.deepEqual(toastCalls, []);
  shell.setNavigationState({ state: "pending", target: "q20", targetOrder: 19, pendingVisible: true });
  assert.deepEqual(toastCalls.at(-1), ["show", "正在定位 Q20…", 0]);
  shell.setNavigationState({ state: "success", target: "q20", targetOrder: 19, pendingVisible: false });
  assert.deepEqual(pending.slice(-2), [["list", null], ["rail", null]]);
  assert.deepEqual(toastCalls.at(-1), ["hide"]);
});

test("Prompt trigger stays at composer left/top and survives anchor replacement", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const root = new FakeElement();
  const anchor1 = new FakeElement("form"); anchor1.rect = { left: 100, top: 200, width: 500, height: 220 };
  const anchor2 = new FakeElement("form"); anchor2.rect = { left: 150, top: 300, width: 500, height: 50 };
  let anchor = anchor1;
  let clicks = 0;
  const host = { getComposerForm: () => anchor, getComposerRect: () => anchor.rect };
  const trigger = new PromptTrigger({ document, window, host, onClick: () => { clicks += 1; } });
  trigger.mount(root);
  trigger.setVisible(true);
  assert.equal(trigger.element.style.left, "62px");
  assert.equal(trigger.element.style.top, "210px");
  anchor = anchor2;
  trigger.refreshAnchor();
  assert.equal(trigger.element.style.left, "112px");
  assert.equal(trigger.element.style.top, "309px");
  for (let i = 0; i < 10; i += 1) trigger.element.fire("click");
  assert.equal(clicks, 10);
});

test("Prompt Panel shows search at five items, saves explicitly, two-step deletes and inserts via host", () => {
  const document = new FakeDocument();
  const storage = new MemoryStorageAdapter();
  let id = 0;
  const store = new PromptStore({ storage, idFactory: () => `p${++id}`, clock: () => id });
  for (let i = 0; i < 5; i += 1) store.create({ title: `T${i}`, text: `Body ${i}` });
  let inserted = "";
  const panel = new PromptPanel({ document, store, host: { insertPrompt: (text) => { inserted = text; return { ok: true }; } } });
  panel.mount(new FakeElement());
  panel.setOpen(true);
  assert.ok(panel.body.querySelector(".gte-prompt-search"));
  panel.openEditor();
  assert.equal(panel.saveEditor("New", "New body"), true);
  const newest = store.list().find((item) => item.title === "New");
  assert.equal(panel.requestDelete(newest.id), false);
  assert.equal(store.list().some((item) => item.id === newest.id), true);
  assert.equal(panel.requestDelete(newest.id), true);
  const item = store.list()[0];
  panel.insertPrompt(item);
  assert.equal(inserted, item.text);
});

test("AppShell surface matrix hides/shows Timeline and Prompt correctly", () => {
  const shell = new AppShell({});
  const calls = [];
  shell.rail = { setVisible: (v) => calls.push(["rail", v]) };
  shell.questionList = { setVisible: (v) => calls.push(["list", v]) };
  shell.promptTrigger = { setVisible: (v) => calls.push(["trigger", v]) };
  shell.promptPanel = { setVisible: (v) => calls.push(["prompt", v]) };
  for (const [surface, timeline, prompt] of [
    [SURFACE.NEW_CHAT, false, true],
    [SURFACE.CONVERSATION, true, true],
    [SURFACE.MEDIA_VIEWER, false, false],
    [SURFACE.SETTINGS, false, false],
    [SURFACE.PLUGIN_MANAGER, false, false],
    [SURFACE.OTHER, false, false]
  ]) {
    calls.length = 0;
    shell.setSurface(surface);
    assert.deepEqual(calls, [["rail", timeline], ["list", timeline], ["trigger", prompt], ["prompt", prompt]]);
  }
});


test("Rail marker geometry follows absolute turn order instead of equal spacing", () => {
  const document = new FakeDocument();
  const rail = new TimelineRail({ document, maxMarkers: 28 });
  rail.mount(new FakeElement());
  rail.setState([
    { id: "q1", order: 0, text: "first" },
    { id: "q33", order: 32, text: "near end" },
    { id: "q37", order: 36, text: "last" }
  ], "q33");
  assert.equal(rail.markers.children[0].style.top, "0.000%");
  assert.equal(rail.markers.children[1].style.top, "88.889%");
  assert.equal(rail.markers.children[2].style.top, "100.000%");
  assert.equal(rail.markers.children[1].classList.contains("is-active"), true);
});

test("Question List anchors to the left side of the timeline rail", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.innerWidth = 1000;
  window.innerHeight = 800;
  const panel = new QuestionListPanel({
    document,
    window,
    getAnchorRect: () => ({ left: 950, top: 100, bottom: 688, width: 28, height: 588 })
  });
  panel.mount(new FakeElement());
  panel.setOpen(true);
  assert.equal(panel.element.style.left, "690px");
  assert.equal(panel.element.style.top, "100px");
  assert.equal(panel.element.style.right, "auto");
});

test("Prompt Panel follows the composer and flips when there is not enough space above", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.innerWidth = 1000;
  window.innerHeight = 900;
  let composer = { left: 180, top: 650, bottom: 694, width: 700, height: 44 };
  const host = { getComposerRect: () => composer, insertPrompt: () => ({ ok: true }) };
  const store = new PromptStore({ storage: new MemoryStorageAdapter() });
  const panel = new PromptPanel({
    document,
    window,
    store,
    host,
    getTriggerRect: () => ({ left: 142, top: composer.top + 6, bottom: composer.top + 38, width: 32, height: 32 })
  });
  panel.mount(new FakeElement());
  panel.setOpen(true);
  assert.equal(panel.element.style.left, "142px");
  assert.equal(panel.element.style.top, "230px");
  assert.equal(panel.element.getAttribute("data-placement"), "above");

  composer = { left: 180, top: 500, bottom: 700, width: 700, height: 200 };
  panel.updatePosition();
  assert.equal(panel.element.style.top, "80px");

  composer = { left: 180, top: 80, bottom: 124, width: 700, height: 44 };
  panel.updatePosition();
  assert.equal(panel.element.style.top, "134px");
  assert.equal(panel.element.getAttribute("data-placement"), "below");
});

test("Prompt and Timeline CSS avoid the old fixed panel geometry", () => {
  const promptCss = fs.readFileSync(path.join(projectRoot, "src/v3/ui/prompt/prompt.css"), "utf8");
  const timelineCss = fs.readFileSync(path.join(projectRoot, "src/v3/ui/timeline/timeline.css"), "utf8");
  assert.doesNotMatch(promptCss, /right:\s*54px/);
  assert.doesNotMatch(promptCss, /bottom:\s*92px/);
  assert.match(timelineCss, /\.gte-rail-marker\.is-active::before/);
  assert.match(timelineCss, /border:\s*2px solid var\(--gte-timeline-active\)/);
  assert.match(timelineCss, /\.gte-rail-marker\.is-pending::before/);
  assert.match(timelineCss, /\.gte-question-row\.is-pending/);
});
