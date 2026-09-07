export class PromptPanel {
  constructor({ document, window, store, host, onToast, getTriggerRect } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.store = store;
    this.host = host;
    this.onToast = onToast ?? (() => {});
    this.getTriggerRect = getTriggerRect ?? (() => null);
    this.element = null;
    this.opened = false;
    this.body = null;
    this.query = "";
    this.editingId = null;
    this.pendingDeleteId = null;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const panel = this.document.createElement("section");
    panel.className = "gte-prompt-panel";
    panel.hidden = true;
    const header = this.document.createElement("header");
    header.className = "gte-prompt-header";
    const title = this.document.createElement("strong");
    title.textContent = "提示词";
    const add = makeButton(this.document, "+", "添加提示词", "gte-prompt-icon-button");
    const close = makeButton(this.document, "\u00d7", "关闭", "gte-prompt-icon-button");
    add.addEventListener("click", () => this.openEditor());
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, add, close);
    this.body = this.document.createElement("div");
    this.body.className = "gte-prompt-body";
    panel.append(header, this.body);
    root.append(panel);
    this.element = panel;
    this.render();
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return panel;
  }

  setOpen(open) {
    this.opened = Boolean(open);
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) {
      this.render();
      this.updatePosition();
      queueMicrotask(() => this.updatePosition());
    }
  }

  toggle() { this.setOpen(!this.opened); }

  setVisible(visible) {
    if (this.element) this.element.hidden = !visible || !this.opened;
    if (visible && this.opened) this.updatePosition();
  }

  updatePosition() {
    if (!this.opened || !this.element) return;
    const composer = this.host?.getComposerRect?.();
    const trigger = this.getTriggerRect?.();
    if (!composer && !trigger) return;

    const viewport = this.window?.visualViewport;
    const viewportWidth = Number(viewport?.width ?? this.window?.innerWidth ?? this.document?.documentElement?.clientWidth ?? 1280);
    const viewportHeight = Number(viewport?.height ?? this.window?.innerHeight ?? this.document?.documentElement?.clientHeight ?? 800);
    const measured = this.element.getBoundingClientRect?.();
    const width = Number(measured?.width) > 120 ? Number(measured.width) : 332;
    const height = Number(measured?.height) > 90 ? Number(measured.height) : Math.min(410, viewportHeight - 24);
    const gap = 10;
    const anchorLeft = Number(trigger?.left ?? composer?.left ?? 12);
    const composerTop = Number(composer?.top ?? trigger?.top ?? 12);
    const composerBottom = Number(composer?.bottom ?? ((composer?.top ?? 12) + (composer?.height ?? 44)));

    let placement = "above";
    let top = composerTop - height - gap;
    if (top < 12) {
      const below = composerBottom + gap;
      if (below + height <= viewportHeight - 12) {
        top = below;
        placement = "below";
      } else {
        top = Math.max(12, viewportHeight - height - 12);
        placement = "clamped";
      }
    }
    const left = Math.max(12, Math.min(viewportWidth - width - 12, anchorLeft));
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.right = "auto";
    this.element.style.bottom = "auto";
    this.element.setAttribute?.("data-placement", placement);
  }

  render() {
    if (!this.body) return;
    if (this.editingId !== null) return this.renderEditor();
    const all = this.store.list();
    this.body.replaceChildren();
    if (all.length === 0) return this.renderEmpty();
    if (all.length >= 5) {
      const search = this.document.createElement("input");
      search.type = "search";
      search.className = "gte-prompt-search";
      search.placeholder = "搜索提示词";
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value;
        this.render();
        queueMicrotask(() => {
          const next = this.body?.querySelector?.(".gte-prompt-search");
          next?.focus?.();
          try { next?.setSelectionRange?.(this.query.length, this.query.length); } catch {}
        });
      });
      this.body.append(search);
    }
    const items = this.query ? this.store.search(this.query) : all;
    const list = this.document.createElement("div");
    list.className = "gte-prompt-list";
    for (const item of items) list.append(this.createItem(item));
    if (!items.length) {
      const empty = this.document.createElement("div");
      empty.className = "gte-prompt-empty-small";
      empty.textContent = "没有匹配的提示词";
      list.append(empty);
    }
    this.body.append(list);
    if (this.opened) queueMicrotask(() => this.updatePosition());
  }

  renderEmpty() {
    const empty = this.document.createElement("div");
    empty.className = "gte-prompt-empty";
    const label = this.document.createElement("div");
    label.textContent = "保存常用提示词";
    const add = makeButton(this.document, "+ 添加提示词", "添加提示词", "gte-primary-button");
    add.addEventListener("click", () => this.openEditor());
    empty.append(label, add);
    this.body.append(empty);
    if (this.opened) queueMicrotask(() => this.updatePosition());
  }

  createItem(item) {
    const row = this.document.createElement("article");
    row.className = "gte-prompt-item";
    row.dataset.promptId = item.id;
    const main = makeButton(this.document, "", item.title, "gte-prompt-item-main");
    const title = this.document.createElement("strong");
    title.textContent = item.title;
    const preview = this.document.createElement("span");
    preview.textContent = item.text;
    main.append(title, preview);
    main.addEventListener("click", () => this.insertPrompt(item));

    const actions = this.document.createElement("div");
    actions.className = "gte-prompt-actions";
    const favorite = makeButton(this.document, item.favorite ? "\u2605" : "\u2606", "收藏", "gte-prompt-action");
    favorite.addEventListener("click", () => { this.store.toggleFavorite(item.id); this.render(); });
    const edit = makeButton(this.document, "\u270e", "编辑", "gte-prompt-action");
    edit.addEventListener("click", () => this.openEditor(item.id));
    const remove = makeButton(this.document, this.pendingDeleteId === item.id ? "确认" : "删", "删除", "gte-prompt-action");
    if (this.pendingDeleteId === item.id) remove.classList.add("is-danger");
    remove.addEventListener("click", () => this.requestDelete(item.id));
    actions.append(favorite, edit, remove);
    row.append(main, actions);
    return row;
  }

  openEditor(id = "") {
    this.pendingDeleteId = null;
    this.editingId = id;
    this.render();
    queueMicrotask(() => this.updatePosition());
  }

  renderEditor() {
    this.body.replaceChildren();
    const item = this.editingId ? this.store.list().find((entry) => entry.id === this.editingId) : null;
    const form = this.document.createElement("form");
    form.className = "gte-prompt-editor";
    const title = this.document.createElement("input");
    title.type = "text";
    title.className = "gte-prompt-input";
    title.placeholder = "标题";
    title.value = item?.title ?? "";
    const text = this.document.createElement("textarea");
    text.className = "gte-prompt-textarea";
    text.placeholder = "提示词内容";
    text.value = item?.text ?? "";
    const actions = this.document.createElement("div");
    actions.className = "gte-editor-actions";
    const cancel = makeButton(this.document, "取消", "取消", "gte-secondary-button");
    const save = makeButton(this.document, "保存", "保存", "gte-primary-button");
    cancel.addEventListener("click", () => { this.editingId = null; this.render(); });
    const saveCurrent = () => this.saveEditor(title.value, text.value);
    save.addEventListener("click", saveCurrent);
    form.addEventListener("submit", (event) => { event.preventDefault(); saveCurrent(); });
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); saveCurrent(); }
    });
    actions.append(cancel, save);
    form.append(title, text, actions);
    this.body.append(form);
  }

  saveEditor(title, text) {
    const content = String(text ?? "").trim();
    if (!content) { this.onToast("提示词内容不能为空"); return false; }
    if (this.editingId) this.store.update(this.editingId, { title, text: content });
    else this.store.create({ title, text: content });
    this.editingId = null;
    this.render();
    this.onToast("提示词已保存");
    return true;
  }

  requestDelete(id) {
    if (this.pendingDeleteId !== id) {
      this.pendingDeleteId = id;
      this.render();
      return false;
    }
    this.store.remove(id);
    this.pendingDeleteId = null;
    this.render();
    this.onToast("提示词已删除");
    return true;
  }

  insertPrompt(item) {
    const result = this.host.insertPrompt(item.text);
    if (result?.ok) {
      this.onToast("已插入提示词");
      this.setOpen(false);
    } else this.onToast("未能插入提示词，请重试");
    return result;
  }

  destroy() {
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.body = null;
  }
}

function makeButton(documentRef, text, title, className) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = title;
  return button;
}
