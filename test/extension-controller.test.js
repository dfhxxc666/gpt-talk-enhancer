import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionController } from "../src/extension-controller.js";

function createControllerWithOverlay({ overlay = false, fullscreen = false } = {}) {
  const dialog = {
    getBoundingClientRect() { return { top: 0, left: 0, right: 900, bottom: 700, width: 900, height: 700 }; }
  };
  const media = { closest() { return dialog; } };
  const documentRef = {
    fullscreenElement: fullscreen ? {} : null,
    documentElement: { clientWidth: 1000, clientHeight: 800 },
    querySelector(selector) {
      return overlay && selector === '[role="dialog"] img' ? media : null;
    }
  };
  const windowRef = { innerWidth: 1000, innerHeight: 800 };
  return new ExtensionController({ document: documentRef, window: windowRef });
}

test("ExtensionController hides owned UI for a large media viewer overlay", () => {
  assert.equal(createControllerWithOverlay({ overlay: true }).isMediaOverlayOpen(), true);
  assert.equal(createControllerWithOverlay({ fullscreen: true }).isMediaOverlayOpen(), true);
  assert.equal(createControllerWithOverlay().isMediaOverlayOpen(), false);
});
