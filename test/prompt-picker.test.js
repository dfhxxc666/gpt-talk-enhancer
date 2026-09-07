import test from "node:test";
import assert from "node:assert/strict";
import { PromptPicker } from "../src/core/prompt-picker.js";
import { PromptStore } from "../src/core/prompt-store.js";
import { MemoryStorageAdapter } from "../src/core/storage-adapter.js";
import { FakeDocument } from "./fake-dom.js";

function createPicker({ anchorRect = { top: 600, bottom: 700, left: 400, right: 900, width: 500, height: 100 } } = {}) {
  const documentRef = new FakeDocument();
  const storage = new MemoryStorageAdapter();
  const store = new PromptStore({
    storage,
    idFactory: (() => {
      let index = 0;
      return () => `prompt-${++index}`;
    })()
  });
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      resizeObservers.push(this);
    }
    observe(element) { this.observed.push(element); }
    disconnect() { this.disconnected = true; }
  }
  const windowRef = {
    ResizeObserver: FakeResizeObserver,
    addEventListener() {},
    removeEventListener() {}
  };
  const picker = new PromptPicker({
    document: documentRef,
    window: windowRef,
    store,
    composer: { insertText: async () => ({ ok: true }) }
  });
  const anchor = documentRef.createElement("form");
  anchor.getBoundingClientRect = () => anchorRect;
  documentRef.body.appendChild(anchor);
  picker.mount({ anchor, kind: "external" });
  return {
    documentRef,
    windowRef,
    store,
    picker,
    anchor,
    resizeObservers,
    setAnchorRect(nextRect) { anchorRect = nextRect; }
  };
}

function triggerEvent(target) {
  return {
    target,
    preventDefault() {},
    stopPropagation() {}
  };
}

test("PromptPicker uses an external portal trigger and centered empty state without search", () => {
  const { documentRef, picker, anchor } = createPicker();
  assert.equal(picker.button.getAttribute("aria-label"), "提示词");
  assert.equal(picker.button.dataset.gtePromptPlacement, "external");
  assert.equal(picker.button.parentElement, documentRef.body);
  assert.equal(anchor.contains(picker.button), false);
  assert.equal(picker.button.querySelector(".gte-prompt-button__icon").textContent, "✦");

  picker.open();
  assert.equal(picker.popup.querySelector(".gte-prompt-popup__title").textContent, "提示词");
  assert.equal(picker.popup.querySelector(".gte-prompt-popup__search"), null);
  const empty = picker.popup.querySelector(".gte-prompt-popup__empty-state");
  assert.ok(empty);
  assert.match(empty.querySelector(".gte-prompt-popup__empty-copy").textContent, /保存常用提示词/);
  assert.equal(empty.querySelector(".gte-prompt-popup__button--primary").dataset.gteAction, "create");
  assert.match(documentRef.head.querySelector('style[data-gte-style="prompt-picker"]').textContent, /width:\s*40px/);
  assert.match(documentRef.head.querySelector('style[data-gte-style="prompt-picker"]').textContent, /\.gte-prompt-button__surface[\s\S]*width:\s*32px/);
  picker.destroy();
});

test("PromptPicker shows search only at five prompts and keeps editor in-panel", () => {
  const { documentRef, store, picker } = createPicker();
  for (let index = 1; index <= 4; index += 1) {
    store.create({ name: `Prompt ${index}`, content: `Content ${index}` });
  }
  picker.open();
  assert.equal(picker.popup.querySelector(".gte-prompt-popup__search"), null);
  assert.equal(picker.popup.querySelectorAll(".gte-prompt-row").length, 4);
  picker.close();

  store.create({ name: "Prompt 5", content: "Content 5" });
  picker.open();
  assert.ok(picker.popup.querySelector(".gte-prompt-popup__search"));
  assert.equal(picker.popup.querySelectorAll(".gte-prompt-row").length, 5);
  assert.equal(picker.popup.querySelector(".gte-prompt-row__content").textContent, "Content 1");
  assert.equal(picker.popup.querySelector(".gte-prompt-popup__header-add").dataset.gteAction, "create");

  picker.showForm();
  assert.ok(picker.popup.querySelector("[data-gte-prompt-form]"));
  assert.equal(picker.popup.querySelector(".gte-prompt-popup__title").textContent, "添加提示词");
  assert.ok(picker.popup.querySelector(".gte-prompt-popup__textarea"));
  const outside = documentRef.createElement("div");
  documentRef.body.appendChild(outside);
  picker.boundDocumentPointerDown({ target: outside });
  assert.equal(picker.opened, false);
  picker.destroy();
});

test("Prompt keyboard click fallback opens and closes 10 out of 10 times", () => {
  const { documentRef, picker } = createPicker();
  const icon = picker.button.querySelector(".gte-prompt-button__icon");

  for (let index = 0; index < 10; index += 1) {
    picker.boundButtonClick(triggerEvent(icon));
    assert.equal(picker.opened, true, `open ${index + 1}`);
    assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1, `one popup ${index + 1}`);

    picker.boundDocumentPointerDown({ target: picker.popup.querySelector(".gte-prompt-popup__title") });
    assert.equal(picker.opened, true, `popup interaction remains open ${index + 1}`);

    picker.boundButtonClick(triggerEvent(icon));
    assert.equal(picker.opened, false, `close ${index + 1}`);
    assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 0, `popup removed ${index + 1}`);
  }
  picker.destroy();
});

test("Prompt pointerdown path is 10/10 and suppresses the pointer follow-up click", () => {
  const { documentRef, picker } = createPicker();
  const icon = picker.button.querySelector(".gte-prompt-button__icon");
  assert.equal(documentRef.eventListeners.get("pointerdown")?.has(picker.boundDocumentPointerDown), true);

  for (let index = 0; index < 10; index += 1) {
    picker.boundDocumentPointerDown(triggerEvent(icon));
    assert.equal(picker.opened, true, `pointer open ${index + 1}`);
    assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1);

    picker.boundButtonClick({ ...triggerEvent(icon), detail: 1 });
    assert.equal(picker.opened, true, `follow-up click ignored ${index + 1}`);
    assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1);

    picker.boundDocumentPointerDown(triggerEvent(icon));
    assert.equal(picker.opened, false, `pointer close ${index + 1}`);
  }
  picker.destroy();
  assert.equal(documentRef.eventListeners.get("pointerdown")?.has(picker.boundDocumentPointerDown), false);
});
test("Prompt outside-click ordering keeps popup interactions open and closes on a real outside target", () => {
  const { documentRef, picker } = createPicker();
  const surface = picker.button.querySelector(".gte-prompt-button__surface");
  picker.boundButtonClick(triggerEvent(surface));
  assert.equal(picker.opened, true);
  picker.boundDocumentPointerDown({ target: picker.popup.querySelector(".gte-prompt-popup__title") });
  assert.equal(picker.opened, true);

  const outside = documentRef.createElement("div");
  documentRef.body.appendChild(outside);
  picker.boundDocumentPointerDown({ target: outside });
  assert.equal(picker.opened, false);
  picker.destroy();
});

test("Prompt trigger rebind replaces the portal node and the first click on the replacement works", () => {
  const { documentRef, picker } = createPicker();
  const firstButton = picker.button;
  const nextAnchor = documentRef.createElement("form");
  nextAnchor.getBoundingClientRect = () => ({ top: 500, bottom: 590, left: 420, right: 900, width: 480, height: 90 });
  documentRef.body.appendChild(nextAnchor);

  assert.equal(picker.mount({ anchor: nextAnchor, kind: "external" }), true);
  assert.notEqual(picker.button, firstButton);
  assert.equal(firstButton.isConnected, false);
  assert.equal(picker.button.parentElement, documentRef.body);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-button"]').length, 1);

  const icon = picker.button.querySelector(".gte-prompt-button__icon");
  picker.boundButtonClick(triggerEvent(icon));
  assert.equal(picker.opened, true);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1);
  picker.destroy();
});

test("Prompt reload-style fresh instance responds to the first pointerdown", () => {
  const { documentRef, windowRef, store, picker, anchor } = createPicker();
  picker.destroy();

  const fresh = new PromptPicker({
    document: documentRef,
    window: windowRef,
    store,
    composer: { insertText: async () => ({ ok: true }) }
  });
  fresh.mount({ anchor, kind: "external" });
  const icon = fresh.button.querySelector(".gte-prompt-button__icon");
  fresh.boundDocumentPointerDown(triggerEvent(icon));

  assert.equal(fresh.opened, true);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1);
  fresh.destroy();
});

test("External trigger positioning keeps a 32px visual button inside a 40px hit target with a 10px composer gap", () => {
  const { picker, resizeObservers, setAnchorRect } = createPicker();
  assert.equal(picker.button.style.left, "354px");
  assert.equal(picker.button.style.top, "610px");
  assert.ok(resizeObservers.length >= 1);

  setAnchorRect({ top: 500, bottom: 600, left: 500, right: 900, width: 400, height: 100 });
  resizeObservers.at(-1).callback();
  assert.equal(picker.button.style.left, "454px");
  assert.equal(picker.button.style.top, "510px");
  picker.destroy();
});

test("Prompt form Save action persists without relying on native submit", () => {
  const { store, picker } = createPicker();
  picker.open();
  picker.showForm();
  picker.formInputs.name.value = "test";
  picker.formInputs.content.value = "test content";
  const save = picker.popup.querySelector(".gte-prompt-popup__button--primary");
  picker.handleClick({
    target: { closest: () => save },
    preventDefault() {},
    stopPropagation() {}
  });

  const prompts = store.search("");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].name, "test");
  assert.equal(prompts[0].content, "test content");
  assert.equal(picker.popup.querySelector("[data-gte-prompt-form]"), null);
  picker.destroy();
});


test("External trigger stays near the ChatGPT composer top even when the form grows", () => {
  const { documentRef, picker, anchor, resizeObservers } = createPicker({
    anchorRect: { top: 100, bottom: 340, left: 400, right: 900, width: 500, height: 240 }
  });
  assert.equal(picker.button.style.top, "110px", "ChatGPT-style top offset is stable on a tall form");
  const footer = documentRef.createElement("div");
  footer.getBoundingClientRect = () => ({ top: 290, bottom: 340, left: 400, right: 900, width: 500, height: 50 });
  anchor.appendChild(footer);
  picker.mount({ anchor, footer, kind: "external" });
  assert.equal(picker.button.style.top, "110px", "footer changes do not drag the trigger downward");
  assert.equal(resizeObservers.at(-1).observed.includes(footer), true);
  picker.destroy();
});
