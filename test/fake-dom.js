export class FakeElement {
  constructor(tagName = "div") {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.className = "";
    this.classList = {
      toggle: (name, force) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        const next = force === undefined ? !values.has(name) : force;
        if (next) values.add(name);
        else values.delete(name);
        this.className = [...values].join(" ");
        return next;
      },
      add: (...names) => names.forEach((name) => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach((name) => this.classList.toggle(name, false)),
      contains: (name) => this.className.split(/\s+/).includes(name)
    };
    this.eventListeners = new Map();
    this.textContent = "";
    this.innerText = "";
    this.value = "";
    this.isConnected = false;
    this.ownerDocument = null;
  }

  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    if (!before) return this.appendChild(child);
    if (child.parentElement) child.parentElement.removeChild(child);
    const index = this.children.indexOf(before);
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    child.isConnected = this.isConnected;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    child.isConnected = false;
    return child;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    nodes.forEach((node) => this.appendChild(node));
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.get(type)?.delete(listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector) {
    const component = selector.match(/^\[data-gte-component="([^"]+)"\]$/);
    if (component) return this.dataset.gteComponent === component[1];
    const style = selector.match(/^style\[data-gte-style="([^"]+)"\]$/);
    if (style) return this.tagName === "STYLE" && this.dataset.gteStyle === style[1];
    if (selector === ".gte-timeline__item[data-turn-key]") return this.classList.contains("gte-timeline__item") && Boolean(this.dataset.turnKey);
    if (selector === ".gte-prompt-row__select") return this.classList.contains("gte-prompt-row__select");
    if (selector === "[data-gte-prompt-list]") return this.dataset.gtePromptList === "true";
    if (selector === "[data-gte-prompt-form]") return this.dataset.gtePromptForm === "true";
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  contains(element) {
    if (element === this) return true;
    return this.children.some((child) => child.contains(element));
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 32, left: 0, right: 80, width: 80, height: 32 };
  }
}

export class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.eventListeners = new Map();
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.documentElement.clientWidth = 1024;
    this.documentElement.clientHeight = 768;
    this.documentElement.ownerDocument = this;
    this.documentElement.isConnected = true;
    this.head.ownerDocument = this;
    this.head.isConnected = true;
    this.body.ownerDocument = this;
    this.body.isConnected = true;
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.eventListeners.get(type)?.delete(listener);
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  querySelector(selector) {
    if (this.documentElement.matches(selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector) {
    const result = [];
    if (this.documentElement.matches(selector)) result.push(this.documentElement);
    return result.concat(this.documentElement.querySelectorAll(selector));
  }
}
