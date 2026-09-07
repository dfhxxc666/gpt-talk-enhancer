import { SELECTORS } from "./constants.js";
import { elementText, normalizeText, queryFirst } from "./dom-utils.js";

export class ComposerAdapter {
  constructor({ document: documentRef = globalThis.document, window: windowRef = globalThis.window, onToast = () => {} } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.onToast = onToast;
  }

  getEditor() {
    return queryFirst(this.document, SELECTORS.editors);
  }

  getText() {
    return readEditorText(this.getEditor());
  }

  async insertText(text) {
    const content = String(text ?? "");
    const editor = this.getEditor();
    const result = insertTextIntoEditor({ editor, document: this.document, text: content });
    if (result.ok) {
      return result;
    }

    const copied = await copyTextToClipboard(content, {
      navigator: this.window?.navigator ?? globalThis.navigator,
      document: this.document
    });
    const message = copied
      ? "自动写入失败，Prompt 已复制到剪贴板"
      : "自动写入失败，请手动复制 Prompt";
    this.onToast(message);
    return { ...result, ok: false, copied, fallback: "clipboard" };
  }
}

export function readEditorText(editor) {
  return normalizeText(elementText(editor));
}

export function insertTextIntoEditor({ editor, document: documentRef, text }) {
  if (!editor || !documentRef || typeof documentRef.execCommand !== "function") {
    return { ok: false, reason: "editor-or-command-unavailable", readBack: readEditorText(editor) };
  }

  try {
    editor.focus?.();
    const commandResult = documentRef.execCommand("insertText", false, String(text ?? ""));
    const readBack = readEditorText(editor);
    const expected = normalizeText(text);
    const ok = commandResult !== false && containsInsertedText(readBack, expected);
    return {
      ok,
      commandResult,
      readBack,
      reason: ok ? null : "read-back-mismatch"
    };
  } catch (error) {
    return {
      ok: false,
      reason: "insert-command-failed",
      error: error instanceof Error ? error.message : String(error),
      readBack: readEditorText(editor)
    };
  }
}

export async function copyTextToClipboard(text, { navigator: navigatorRef = globalThis.navigator, document: documentRef = globalThis.document } = {}) {
  if (navigatorRef?.clipboard?.writeText) {
    try {
      await navigatorRef.clipboard.writeText(String(text ?? ""));
      return true;
    } catch {
      // Fall through to the scoped legacy copy path.
    }
  }

  if (!documentRef?.createElement || !documentRef.body || typeof documentRef.execCommand !== "function") {
    return false;
  }
  const textarea = documentRef.createElement("textarea");
  textarea.value = String(text ?? "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  documentRef.body.appendChild(textarea);
  textarea.select?.();
  let copied = false;
  try {
    copied = documentRef.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function containsInsertedText(readBack, expected) {
  if (!expected) return true;
  const normalizedReadBack = normalizeText(readBack);
  return normalizedReadBack.includes(expected) || normalizedReadBack.replace(/\s+/g, " ").includes(expected.replace(/\s+/g, " "));
}
