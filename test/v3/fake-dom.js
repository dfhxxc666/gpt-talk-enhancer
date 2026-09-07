export class FakeClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); this.sync(); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); this.sync(); }
  contains(name) { return this.values.has(name); }
  sync() { this.owner._className = [...this.values].join(" "); }
  setFromString(value) { this.values = new Set(String(value).split(/\s+/).filter(Boolean)); this.sync(); }
}

export class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
    this._className = "";
    this.textContent = "";
    this.innerText = "";
    this.hidden = false;
    this.style = {};
    this.scrollTop = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 300;
    this.offsetWidth = 32;
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.removed = false;
    this.focused = false;
  }
  set className(value) { this.classList.setFromString(value); }
  get className() { return this._className; }
  append(...nodes) { for (const node of nodes) { if (!node) continue; node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.removed = true; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((x) => x !== this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, fn) { const list = this.listeners.get(type) ?? []; list.push(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { const list = this.listeners.get(type) ?? []; this.listeners.set(type, list.filter((item) => item !== fn)); }
  fire(type, event = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {}, key: event.key, ...event }); }
  focus() { this.focused = true; }
  dispatchEvent(event) { this.fire(event.type, event); return true; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  contains(node) { if (node === this) return true; return this.children.some((child) => child.contains?.(node)); }
  closest(selector) {
    if (selector === "form") {
      let node = this;
      while (node) { if (node.tagName === "FORM") return node; node = node.parentElement; }
      return null;
    }
    return null;
  }
  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    const stack = [...this.children];
    while (stack.length) {
      const node = stack.shift();
      if (className && node.classList?.contains(className)) return node;
      stack.push(...(node.children ?? []));
    }
    return null;
  }
  getBoundingClientRect() {
    if (this.classList.contains("gte-question-list")) return { top: 100, bottom: 400, left: 0, right: 250, width: 250, height: 300 };
    if (this.classList.contains("gte-question-row") && this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      const top = 100 + index * 34 - this.parentElement.scrollTop;
      return { top, bottom: top + 34, left: 0, right: 250, width: 250, height: 34 };
    }
    return this.rect ?? { top: 0, bottom: 32, left: 0, right: 32, width: 32, height: 32 };
  }
  scrollIntoView() {
    if (this.classList.contains("gte-question-row") && this.parentElement) {
      const index = this.parentElement.children.indexOf(this);
      this.parentElement.scrollTop = Math.max(0, index * 34 - 120);
    }
    this.scrolledIntoView = true;
  }
}

export class FakeDocument {
  constructor() {
    this.body = new FakeElement("body");
    this.documentElement = new FakeElement("html");
    this.scrollingElement = this.body;
    this.selectorMap = new Map();
  }
  createElement(tag) { return new FakeElement(tag); }
  createTextNode(text) { const node = new FakeElement("#text"); node.textContent = text; node.innerText = text; return node; }
  querySelector(selector) { return this.selectorMap.get(selector) ?? null; }
  querySelectorAll(selector) { const value = this.selectorMap.get(selector); return Array.isArray(value) ? value : value ? [value] : []; }
  getElementById() { return null; }
  setSelector(selector, value) { this.selectorMap.set(selector, value); }
}

export function fakeWindow(document = new FakeDocument()) {
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; }
    observe(node) { this.observed.push(node); }
    disconnect() { this.disconnected = true; }
  }
  return {
    document,
    location: { href: "app://-/", pathname: "/", search: "", hash: "" },
    innerHeight: 900,
    ResizeObserver,
    Event: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    InputEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    addEventListener() {},
    removeEventListener() {},
    matchMedia() { return { matches: true }; },
    getComputedStyle() { return { overflowY: "auto" }; }
  };
}
