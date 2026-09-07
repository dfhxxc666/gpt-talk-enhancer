export class Toast {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.element = null;
    this.timer = null;
  }

  mount(root) {
    if (this.element) return this.element;
    const element = this.document.createElement("div");
    element.className = "gte-toast";
    element.hidden = true;
    element.setAttribute("role", "status");
    root.append(element);
    this.element = element;
    return element;
  }

  setViewportRect(rect = null, viewportWidth = 0) {
    if (!this.element) return null;
    const left = Number(rect?.left);
    const right = Number(rect?.right);
    const width = Number(viewportWidth);
    if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
      const clampedLeft = width > 0 ? Math.max(0, Math.min(width, left)) : left;
      const clampedRight = width > 0 ? Math.max(clampedLeft, Math.min(width, right)) : right;
      const center = Math.round((clampedLeft + clampedRight) / 2);
      this.element.style.left = `${center}px`;
      return center;
    }
    this.element.style.left = "50%";
    return null;
  }

  show(message, timeout = 1800) {
    if (!this.element) return;
    this.element.textContent = String(message ?? "");
    this.element.hidden = false;
    if (this.timer) this.window?.clearTimeout?.(this.timer);
    this.timer = null;
    if (timeout > 0) {
      this.timer = this.window?.setTimeout?.(() => {
        this.hide();
      }, timeout) ?? null;
    }
  }

  hide() {
    if (this.timer) this.window?.clearTimeout?.(this.timer);
    this.timer = null;
    if (this.element) this.element.hidden = true;
  }

  destroy() {
    this.hide();
    this.element?.remove?.();
    this.element = null;
  }
}
