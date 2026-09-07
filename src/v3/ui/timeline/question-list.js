import { normalizeQuestionDisplayText } from "../../core/question-display.js";

export class QuestionListPanel {
  constructor({ document, window, onSelect, onOpenChange, getAnchorRect } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.onSelect = onSelect ?? (() => {});
    this.onOpenChange = onOpenChange ?? (() => {});
    this.getAnchorRect = getAnchorRect ?? (() => null);
    this.element = null;
    this.list = null;
    this.count = null;
    this.followButton = null;
    this.turns = [];
    this.signature = "";
    this.activeTurnId = null;
    this.pendingTurnId = null;
    this.opened = false;
    this.manualBrowse = false;
    this.suppressScroll = false;
    this.programmaticScrollTop = null;
    this.renderCount = 0;
    this.activeUpdateCount = 0;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const panel = this.document.createElement("section");
    panel.className = "gte-question-panel";
    panel.hidden = true;

    const header = this.document.createElement("header");
    header.className = "gte-question-header";
    const title = this.document.createElement("strong");
    title.textContent = "Questions";
    const count = this.document.createElement("span");
    count.className = "gte-question-count";
    const follow = this.document.createElement("button");
    follow.type = "button";
    follow.className = "gte-follow-active";
    follow.textContent = "\u25ce";
    follow.title = "跟随当前提问";
    follow.addEventListener("click", () => {
      this.manualBrowse = false;
      this.scrollActiveIntoView();
    });
    const close = this.document.createElement("button");
    close.type = "button";
    close.className = "gte-question-close";
    close.textContent = "\u00d7";
    close.title = "关闭";
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, count, follow, close);

    const list = this.document.createElement("div");
    list.className = "gte-question-list";
    list.setAttribute("role", "listbox");
    list.addEventListener("wheel", () => { this.manualBrowse = true; }, { passive: true });
    list.addEventListener("scroll", () => {
      const escapedProgrammaticTarget = this.suppressScroll
        && this.programmaticScrollTop != null
        && Math.abs(this.list.scrollTop - this.programmaticScrollTop) > 1;
      if (!this.suppressScroll || escapedProgrammaticTarget) {
        this.manualBrowse = true;
        this.suppressScroll = false;
        this.programmaticScrollTop = null;
      }
    }, { passive: true });

    panel.append(header, list);
    root.append(panel);
    this.element = panel;
    this.list = list;
    this.count = count;
    this.followButton = follow;
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return panel;
  }

  setOpen(open) {
    this.opened = Boolean(open);
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) {
      this.manualBrowse = false;
      this.updatePosition();
      this.scrollActiveIntoView();
    }
    this.onOpenChange(this.opened);
  }

  toggle() { this.setOpen(!this.opened); }

  setVisible(visible) {
    if (!visible) {
      if (this.element) this.element.hidden = true;
      return;
    }
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) this.updatePosition();
  }

  updatePosition() {
    if (!this.opened || !this.element) return;
    const anchor = this.getAnchorRect?.();
    if (!anchor) return;
    const viewportWidth = Number(this.window?.visualViewport?.width ?? this.window?.innerWidth ?? 1280);
    const viewportHeight = Number(this.window?.visualViewport?.height ?? this.window?.innerHeight ?? 800);
    const width = 250;
    const desiredHeight = Math.min(620, viewportHeight * 0.68);
    const left = Math.max(12, Math.min(viewportWidth - width - 12, anchor.left - width - 10));
    const top = Math.max(12, Math.min(viewportHeight - desiredHeight - 12, anchor.top));
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.right = "auto";
  }

  setTurns(turns) {
    const next = Array.isArray(turns) ? turns : [];
    const signature = next.map((turn) => `${turn.id}\u0000${turn.text}`).join("\u0001");
    if (signature === this.signature) {
      this.turns = next;
      return false;
    }
    const anchor = this.captureAnchor();
    this.signature = signature;
    this.turns = next;
    this.renderRows();
    this.restoreAnchor(anchor);
    if (this.opened) this.updatePosition();
    return true;
  }

  setActive(turnId, { forceFollow = false } = {}) {
    if (this.activeTurnId === turnId) return;
    const previous = this.activeTurnId;
    this.activeTurnId = turnId ?? null;
    this.activeUpdateCount += 1;
    if (previous) this.findRow(previous)?.classList.remove("is-active");
    const current = this.findRow(this.activeTurnId);
    current?.classList.add("is-active");
    current?.setAttribute?.("aria-selected", "true");
    if (previous) this.findRow(previous)?.setAttribute?.("aria-selected", "false");
    if (this.opened && (forceFollow || !this.manualBrowse)) this.scrollActiveIntoView();
  }

  setPending(turnId) {
    if (this.pendingTurnId === turnId) return;
    const previous = this.pendingTurnId;
    this.pendingTurnId = turnId ?? null;
    if (previous) this.findRow(previous)?.classList.remove("is-pending");
    if (this.pendingTurnId) this.findRow(this.pendingTurnId)?.classList.add("is-pending");
  }

  renderRows() {
    if (!this.list) return;
    this.renderCount += 1;
    this.list.replaceChildren();
    this.count.textContent = String(this.turns.length);
    this.turns.forEach((turn, index) => {
      const row = this.document.createElement("button");
      row.type = "button";
      row.className = "gte-question-row";
      if (turn.id === this.activeTurnId) row.classList.add("is-active");
      if (turn.id === this.pendingTurnId) row.classList.add("is-pending");
      row.dataset.turnId = turn.id;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", turn.id === this.activeTurnId ? "true" : "false");
      const number = this.document.createElement("span");
      number.className = "gte-question-number";
      const order = Number.isFinite(turn?.order) ? Number(turn.order) : index;
      number.textContent = `Q${order + 1}`;
      const text = this.document.createElement("span");
      text.className = "gte-question-text";
      const displayText = normalizeQuestionDisplayText(turn.text);
      text.textContent = displayText || "(empty question)";
      row.title = displayText || `Q${order + 1}`;
      row.append(number, text);
      row.addEventListener("click", () => this.onSelect(turn.id));
      this.list.append(row);
    });
  }

  captureAnchor() {
    if (!this.list || !this.turns.length) return null;
    const listRect = this.list.getBoundingClientRect?.();
    if (!listRect) return null;
    for (const row of this.list.children ?? []) {
      const rect = row.getBoundingClientRect?.();
      if (rect && rect.bottom > listRect.top) return { turnId: row.dataset.turnId, offset: rect.top - listRect.top };
    }
    return null;
  }

  restoreAnchor(anchor) {
    if (!anchor || !this.list) return;
    const row = this.findRow(anchor.turnId);
    const listRect = this.list.getBoundingClientRect?.();
    const rowRect = row?.getBoundingClientRect?.();
    if (!row || !listRect || !rowRect) return;
    this.suppressScroll = true;
    this.list.scrollTop += (rowRect.top - listRect.top) - anchor.offset;
    this.programmaticScrollTop = this.list.scrollTop;
    queueMicrotask(() => { this.suppressScroll = false; this.programmaticScrollTop = null; });
  }

  scrollActiveIntoView() {
    const row = this.findRow(this.activeTurnId);
    if (!row) return;
    this.suppressScroll = true;
    row.scrollIntoView?.({ block: "center", behavior: "auto" });
    this.programmaticScrollTop = this.list.scrollTop;
    queueMicrotask(() => { this.suppressScroll = false; this.programmaticScrollTop = null; });
  }

  findRow(turnId) {
    if (!turnId || !this.list) return null;
    for (const row of this.list.children ?? []) if (row.dataset?.turnId === turnId) return row;
    return null;
  }

  getViewState() {
    const anchor = this.captureAnchor();
    return {
      panelOpen: this.opened,
      manualBrowse: this.manualBrowse,
      anchorTurnId: anchor?.turnId ?? null,
      anchorOffset: anchor?.offset ?? 0
    };
  }

  restoreViewState(state = {}) {
    this.opened = Boolean(state.panelOpen);
    if (this.element) this.element.hidden = !this.opened;
    this.manualBrowse = Boolean(state.manualBrowse);
    if (this.opened) this.updatePosition();
    if (state.anchorTurnId) this.restoreAnchor({ turnId: state.anchorTurnId, offset: Number(state.anchorOffset) || 0 });
    else if (this.opened && !this.manualBrowse) this.scrollActiveIntoView();
  }

  destroy() {
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.list = null;
    this.pendingTurnId = null;
  }
}
