import test from "node:test";
import assert from "node:assert/strict";
import { TimelineRenderer } from "../src/core/timeline-renderer.js";
import { FakeDocument } from "./fake-dom.js";

function clickEvent(actionElement, target = null) {
  let prevented = 0;
  let stopped = 0;
  const event = {
    target: target ?? { closest: () => actionElement },
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; }
  };
  if (target && typeof target.closest !== "function") target.closest = () => actionElement;
  return { event, prevented: () => prevented, stopped: () => stopped };
}

test("Timeline exposes one Earlier chevron in collapsed and expanded states", () => {
  const documentRef = new FakeDocument();
  let calls = 0;
  const renderer = new TimelineRenderer({
    document: documentRef,
    onEarlier: () => { calls += 1; }
  });

  renderer.mount();
  assert.equal(renderer.root.querySelectorAll(".gte-timeline__earlier").length, 1);
  assert.equal(renderer.root.querySelectorAll(".gte-timeline__track").length, 1);
  assert.equal(renderer.root.querySelector(".gte-timeline__earlier-icon").textContent, "⌃");
  assert.equal(renderer.root.querySelector(".gte-timeline__earlier").getAttribute("title"), null);
  renderer.handleClick(clickEvent(renderer.root.querySelector(".gte-timeline__earlier")).event);
  assert.equal(calls, 1);

  renderer.setEarlierState("Loading…");
  const loadingButton = renderer.root.querySelector(".gte-timeline__earlier");
  assert.equal(loadingButton.querySelector(".gte-timeline__earlier-icon").textContent, "↻");
  assert.equal(loadingButton.dataset.gteState, "loading");
  renderer.handleClick(clickEvent(loadingButton).event);
  assert.equal(calls, 1);

  renderer.setExpanded(true);
  assert.equal(renderer.root.querySelectorAll(".gte-timeline__earlier").length, 1);
  renderer.setEarlierState("No more discovered");
  const exhaustedButton = renderer.root.querySelector(".gte-timeline__earlier");
  assert.equal(exhaustedButton.querySelector(".gte-timeline__earlier-icon").textContent, "·");
  assert.equal(exhaustedButton.dataset.gteState, "exhausted");
  assert.match(exhaustedButton.dataset.tooltip, /本次未发现更早对话/);
  renderer.handleClick(clickEvent(exhaustedButton).event);
  assert.equal(calls, 2);
  renderer.destroy();
});

test("Timeline rail renders 30px hit areas, summaries, and one active node", () => {
  const documentRef = new FakeDocument();
  const renderer = new TimelineRenderer({ document: documentRef });
  renderer.mount();
  renderer.setState({
    records: [
      { key: "turn-1", shortText: "First question" },
      { key: "turn-2", shortText: "Current question" },
      { key: "turn-3", shortText: "Last question" }
    ],
    activeKey: "turn-2"
  });

  const nodes = renderer.root.querySelectorAll(".gte-timeline__node");
  assert.equal(nodes.length, 3);
  assert.equal(renderer.root.querySelectorAll(".gte-timeline__node--active").length, 1);
  assert.equal(nodes[1].dataset.turnKey, "turn-2");
  assert.equal(nodes[1].getAttribute("aria-selected"), "true");
  assert.equal(nodes[1].querySelector(".gte-timeline__node-dot").getAttribute("aria-hidden"), "true");
  assert.equal(nodes[1].dataset.tooltip, "Current question");
  assert.equal(renderer.root.querySelector(".gte-timeline__rail").textContent.includes("Timeline"), false);
  const css = documentRef.head.querySelector('style[data-gte-style="timeline"]').textContent;
  assert.match(css, /\.gte-timeline__rail[\s\S]*width:\s*28px/);
  assert.match(css, /\.gte-timeline__node\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px/);
  renderer.destroy();
});

test("Expanded Timeline uses the 250px reference question-list panel and keeps rows clickable", () => {
  const documentRef = new FakeDocument();
  const selected = [];
  const renderer = new TimelineRenderer({
    document: documentRef,
    expanded: true,
    onSelect: (key) => { selected.push(key); }
  });
  renderer.mount();
  renderer.setState({
    records: [
      { key: "turn-a", shortText: "Clickable question A" },
      { key: "turn-b", shortText: "Clickable question B" }
    ]
  });

  const rows = renderer.getItems();
  assert.equal(rows.length, 2);
  const firstRow = rows[0];
  const rowText = firstRow.querySelector(".gte-timeline__item-text");
  const interaction = clickEvent(firstRow, rowText);
  renderer.handlePointerDown(interaction.event);
  assert.deepEqual(selected, ["turn-a"]);
  assert.equal(interaction.prevented(), 1);
  assert.equal(interaction.stopped(), 1);
  assert.equal(renderer.focusKey, "turn-a");

  interaction.event.detail = 1;
  renderer.handleClick(interaction.event);
  assert.deepEqual(selected, ["turn-a"], "pointer follow-up click must not jump twice");

  const css = documentRef.head.querySelector('style[data-gte-style="timeline"]').textContent;
  assert.match(css, /\.ait-question-list-popup\s*\{[\s\S]*width:\s*250px/);
  assert.match(css, /\.gte-timeline__item\s*\{[\s\S]*pointer-events:\s*auto/);
  renderer.destroy();
});

test("Expanded Timeline keeps full CJK text and lets the reference list CSS ellipsize it", () => {
  const documentRef = new FakeDocument();
  const renderer = new TimelineRenderer({ document: documentRef, expanded: true });
  renderer.mount();
  const longText = "这是一个非常非常长的中文时间线标题用于验证不会在界面边缘显示半截汉字并且会使用省略号";
  renderer.setState({ records: [{ key: "turn-long", shortText: longText, text: longText }] });

  const row = renderer.getItems()[0];
  const label = row.querySelector(".gte-timeline__item-text").textContent;
  const node = renderer.root.querySelector(".gte-timeline__node");
  assert.equal(label, longText);
  assert.equal(row.getAttribute("title"), null);
  assert.equal(node.getAttribute("title"), null);
  const css = documentRef.head.querySelector('style[data-gte-style="timeline"]').textContent;
  assert.match(css, /expanded \.gte-timeline__earlier::after/);
  assert.match(css, /\.ait-ql-item-text[\s\S]*text-overflow:\s*ellipsis/);
  renderer.destroy();
});
test("Timeline active changes update in place and preserve the expanded list viewport", () => {
  const documentRef = new FakeDocument();
  const renderer = new TimelineRenderer({ document: documentRef, expanded: true });
  renderer.mount();
  const records = Array.from({ length: 30 }, (_, index) => ({ key: `turn-${index + 1}`, shortText: `Question ${index + 1}` }));
  renderer.setState({ records, activeKey: "turn-20" });
  const firstList = renderer.root.querySelector(".gte-timeline__list");
  firstList.scrollTop = 238;
  renderer.boundPanelScroll({ target: firstList });

  renderer.setState({ records, activeKey: "turn-21" });
  const nextList = renderer.root.querySelector(".gte-timeline__list");
  assert.equal(nextList, firstList, "active-only changes must not rebuild the list");
  assert.equal(nextList.scrollTop, 238);
  const active = renderer.getItems().find((item) => item.dataset.turnKey === "turn-21");
  assert.equal(active.classList.contains("gte-timeline__item--active"), true);
  assert.equal(active.getAttribute("aria-selected"), "true");
  renderer.destroy();
});

test("Timeline viewport snapshots restore by row identity when structural records change", () => {
  const documentRef = new FakeDocument();
  const renderer = new TimelineRenderer({ document: documentRef, expanded: true });
  renderer.mount();
  renderer.setState({ records: [
    { key: "turn-a", shortText: "A" },
    { key: "turn-b", shortText: "B" },
    { key: "turn-c", shortText: "C" }
  ] });
  const list = renderer.root.querySelector(".gte-timeline__list");
  const rows = renderer.getItems();
  rows.forEach((row, index) => { row.offsetTop = index * 40; row.offsetHeight = 38; });
  list.scrollTop = 45;
  const snapshot = renderer.capturePanelViewport(list);
  assert.equal(snapshot.anchor.key, "turn-b");
  assert.equal(snapshot.anchor.offset, -5);

  const replacement = documentRef.createElement("div");
  replacement.className = "gte-timeline__list";
  replacement.scrollTop = 0;
  for (const [index, key] of ["turn-new", "turn-a", "turn-b", "turn-c"].entries()) {
    const row = documentRef.createElement("button");
    row.className = "gte-timeline__item";
    row.dataset.turnKey = key;
    row.offsetTop = index * 40;
    row.offsetHeight = 38;
    replacement.appendChild(row);
  }
  renderer.restorePanelViewport(replacement, snapshot);
  assert.equal(replacement.scrollTop, 85, "the same visible row should stay at the same relative offset after prepend");
  renderer.destroy();
});

test("Long Timeline rail samples density while keeping first, last, and active turns clickable", () => {
  const documentRef = new FakeDocument();
  const originalCreateElement = documentRef.createElement.bind(documentRef);
  documentRef.createElement = (tagName) => {
    const element = originalCreateElement(tagName);
    if (String(tagName).toLowerCase() === "div") element.clientHeight = 160;
    return element;
  };
  const renderer = new TimelineRenderer({ document: documentRef });
  renderer.mount();
  const records = Array.from({ length: 60 }, (_, index) => ({ key: `turn-${index + 1}`, shortText: `Question ${index + 1}` }));
  renderer.setState({ records, activeKey: "turn-40" });

  const nodes = renderer.root.querySelectorAll(".gte-timeline__node");
  assert.ok(nodes.length < records.length);
  assert.ok(nodes.length >= 4);
  const keys = nodes.map((node) => node.dataset.turnKey);
  assert.equal(keys[0], "turn-1");
  assert.equal(keys.at(-1), "turn-60");
  assert.equal(keys.includes("turn-40"), true, "active turn must always be represented in a sampled rail");
  const indices = nodes.map((node) => Number(node.dataset.gteSampleIndex));
  assert.deepEqual(indices, [...new Set(indices)].sort((a, b) => a - b));
  const positions = nodes.map((node) => Number.parseFloat(node.style.top));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] > positions[index - 1]);
    assert.ok((positions[index] - positions[index - 1]) * 1.6 >= 30, "sampled 30px hit targets must not overlap in a 160px rail");
  }
  const css = documentRef.head.querySelector('style[data-gte-style="timeline"]').textContent;
  assert.match(css, /\.gte-timeline__node\s*\{[\s\S]*width:\s*30px;[\s\S]*height:\s*30px/);
  renderer.destroy();
});
test("Collapsed Timeline uses a floating rail tooltip outside the scroll canvas", () => {
  const documentRef = new FakeDocument();
  const renderer = new TimelineRenderer({ document: documentRef });
  renderer.mount();
  renderer.setState({ records: [{ key: "turn-tip", text: "完整问题提示内容" }] });
  const node = renderer.root.querySelector(".gte-timeline__node");
  assert.equal(renderer.showRailTooltip(node), true);
  const tooltip = renderer.root.querySelector(".gte-timeline__rail-tooltip");
  assert.equal(tooltip.textContent, "完整问题提示内容");
  assert.equal(tooltip.getAttribute("aria-hidden"), "false");
  assert.equal(tooltip.classList.contains("gte-timeline__rail-tooltip--visible"), true);
  const css = documentRef.head.querySelector('style[data-gte-style="timeline"]').textContent;
  assert.match(css, /\.gte-timeline__node::after,[\s\S]*display:\s*none/);
  renderer.destroy();
});


test("Rail sampling lets an active turn displace a colliding endpoint instead of overlapping hit targets", () => {
  const documentRef = new FakeDocument();
  const originalCreateElement = documentRef.createElement.bind(documentRef);
  documentRef.createElement = (tagName) => {
    const element = originalCreateElement(tagName);
    if (String(tagName).toLowerCase() === "div") element.clientHeight = 160;
    return element;
  };
  const renderer = new TimelineRenderer({ document: documentRef });
  renderer.mount();
  const records = Array.from({ length: 60 }, (_, index) => ({ key: `turn-${index + 1}`, shortText: `Question ${index + 1}` }));
  renderer.setState({ records, activeKey: "turn-56" });
  const nodes = renderer.root.querySelectorAll(".gte-timeline__node");
  assert.equal(nodes.some((node) => node.dataset.turnKey === "turn-56"), true);
  const positions = nodes.map((node) => Number.parseFloat(node.style.top));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok((positions[index] - positions[index - 1]) * 1.6 >= 30);
  }
  renderer.destroy();
});
