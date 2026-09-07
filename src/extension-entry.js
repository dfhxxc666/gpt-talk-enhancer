import { ExtensionController } from "./extension-controller.js";

const start = () => {
  document.documentElement?.setAttribute?.("data-gte-extension-active", "true");
  document.dispatchEvent(new CustomEvent("gte:extension-active"));
  const previous = window.__GPTTalkEnhancerExtension;
  previous?.destroy?.();
  const controller = new ExtensionController({ document, window });
  window.__GPTTalkEnhancerExtension = controller;
  controller.start();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
