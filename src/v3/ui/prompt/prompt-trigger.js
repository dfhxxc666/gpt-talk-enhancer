export class PromptTrigger {
  constructor({ document, window, host, onClick, onPositionChange } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.host = host;
    this.onClick = onClick ?? (() => {});
    this.onPositionChange = onPositionChange ?? (() => {});
    this.element = null;
    this.anchor = null;
    this.resizeObserver = null;
    this.visible = false;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const button = this.document.createElement("button");
    button.type = "button";
    button.className = "gte-prompt-trigger";
    button.textContent = "\u2726";
    button.title = "Prompt Library";
    button.setAttribute("aria-label", "Prompt Library");
    button.hidden = true;
    button.addEventListener("click", () => this.onClick());
    root.append(button);
    this.element = button;
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return button;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (!this.element) return;
    this.element.hidden = !this.visible;
    if (this.visible) this.refreshAnchor();
  }

  refreshAnchor() {
    const next = this.host?.getComposerForm?.() ?? this.host?.getComposer?.()?.parentElement ?? null;
    if (next !== this.anchor) {
      this.resizeObserver?.disconnect?.();
      this.resizeObserver = null;
      this.anchor = next;
      if (next && typeof this.window?.ResizeObserver === "function") {
        this.resizeObserver = new this.window.ResizeObserver(() => this.updatePosition());
        this.resizeObserver.observe(next);
      }
    }
    this.updatePosition();
  }

  updatePosition() {
    if (!this.visible || !this.element) return;
    const rect = this.host?.getComposerRect?.();
    if (!rect) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;
    const buttonWidth = this.element.offsetWidth || 32;
    const buttonHeight = this.element.offsetHeight || 32;
    const gap = 6;
    const compactHeight = Math.min(Number(rect.height) || 44, 52);
    const verticalInset = Math.min(10, Math.max(6, (compactHeight - buttonHeight) / 2));
    const left = Math.max(8, rect.left - buttonWidth - gap);
    const top = Math.max(8, rect.top + verticalInset);
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.onPositionChange({ left, top, rect, triggerRect: this.element.getBoundingClientRect?.() ?? null });
  }

  destroy() {
    this.resizeObserver?.disconnect?.();
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.anchor = null;
  }
}
