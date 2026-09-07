import test from "node:test";
import assert from "node:assert/strict";
import { insertTextIntoEditor, readEditorText } from "../src/core/composer-adapter.js";

test("composer insertion uses execCommand and verifies read-back", () => {
  const editor = {
    innerText: "Existing text",
    focusCalled: false,
    focus() { this.focusCalled = true; }
  };
  const documentRef = {
    execCommand(command, _showUi, value) {
      assert.equal(command, "insertText");
      editor.innerText += value;
      return true;
    }
  };
  const result = insertTextIntoEditor({ editor, document: documentRef, text: " Prompt" });
  assert.equal(result.ok, true);
  assert.equal(editor.focusCalled, true);
  assert.equal(readEditorText(editor), "Existing text Prompt");
});

test("composer insertion fails closed when read-back does not contain the prompt", () => {
  const editor = { innerText: "Existing", focus() {} };
  const result = insertTextIntoEditor({
    editor,
    document: { execCommand: () => true },
    text: "Prompt"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "read-back-mismatch");
});
