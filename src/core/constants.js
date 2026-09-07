export const VERSION = "0.2.0";

export const TIMELINE_MODE = "progressive";

export const STORAGE_KEYS = Object.freeze({
  prompts: "gpt-talk-enhancer.prompts.v1",
  settings: "gpt-talk-enhancer.settings.v1"
});

export const SCROLL_MODEL = Object.freeze({
  composerFooterHeight: 114,
  exactCorrectionOffset: 12
});

export const SELECTORS = Object.freeze({
  conversationRoots: [
    '[data-thread-find-target="conversation"]',
    '[data-chatgpt-conversation-selection-target="true"]'
  ],
  scrollContainers: [
    '[data-app-action-timeline-scroll]',
    '.thread-scroll-container'
  ],
  userMessages: [
    '[data-turn="user"][data-turn-id]',
    '[data-user-message-bubble="true"]',
    '[data-markdown-text-tone="user-message"]'
  ],
  turnKeys: [
    '[data-turn-id-container]',
    '[data-turn-id]',
    '[data-content-search-turn-key]',
    '[data-turn-key]'
  ],
  composerRoots: [
    'form[data-thread-find-composer="true"][data-composer-placement="thread"]',
    'form[data-thread-find-composer="true"]',
    '[data-codex-composer-root][data-composer-placement="thread"]',
    '[data-codex-composer-root]'
  ],
  editors: [
    '#prompt-textarea',
    '[data-thread-find-composer="true"] [contenteditable="true"][role="textbox"][data-composer-markdown]',
    '[contenteditable="true"][role="textbox"][aria-label="给 ChatGPT 发消息"]'
  ],
  primaryComposerMounts: [
    '[data-thread-find-composer="true"] [data-composer-footer-responsive]',
    '[data-composer-footer-responsive]'
  ],
  fallbackComposerAnchors: [
    'button[data-composer-navigation-target="add-context"]'
  ]
});

export const OWNED_SELECTORS = Object.freeze({
  timeline: '[data-gte-component="timeline"]',
  promptButton: '[data-gte-component="prompt-button"]',
  promptPopup: '[data-gte-component="prompt-popup"]',
  toast: '[data-gte-component="toast"]'
});

export const OWNED_CLASSES = Object.freeze({
  timeline: "gte-timeline",
  timelineExpanded: "gte-timeline--expanded",
  timelineCollapsed: "gte-timeline--collapsed",
  promptButton: "gte-prompt-button",
  promptPopup: "gte-prompt-popup",
  toast: "gte-toast"
});
