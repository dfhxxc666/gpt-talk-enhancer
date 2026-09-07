import { readEditorText } from "./composer-adapter.js";

export async function runVirtualizationSpike({
  adapter,
  root,
  scrollContainer,
  editor = null,
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  maxSteps = 256,
  settleMs = 80
} = {}) {
  const startedAt = Date.now();
  if (!adapter || !root || !scrollContainer) {
    return failedSpike("missing-conversation-or-scroll-context", startedAt);
  }

  const before = captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef });
  const initialBounds = adapter.getScrollBounds();
  const initialRenderedTurns = adapter.getRenderedUserTurns(root, scrollContainer);
  const metadata = new Map();
  const discoveredKeys = new Set();
  const positions = [];
  const step = Math.max(1, Math.floor(initialBounds.clientHeight * 0.8) || 1);
  const targets = buildScanTargets(initialBounds.maxLogicalPosition, step, maxSteps, before.logicalPosition);

  for (const target of targets) {
    adapter.setLogicalScrollPosition(target, { behavior: "auto", container: scrollContainer });
    await settle(windowRef, settleMs);
    const actualPosition = adapter.getLogicalScrollPosition();
    positions.push({ requested: target, actual: actualPosition });
    for (const turn of adapter.getRenderedUserTurns(root, scrollContainer)) {
      discoveredKeys.add(turn.key);
      metadata.set(turn.key, {
        key: turn.key,
        logicalOrder: turn.logicalOrder,
        approximatePosition: turn.approximatePosition,
        metadata: turn.metadata
      });
    }
  }

  const finalBounds = adapter.getScrollBounds();
  const setSizes = [...metadata.values()]
    .map((item) => item.metadata?.ariaSetsize)
    .filter((value) => Number.isFinite(value));
  const declaredSize = setSizes.length ? Math.max(...setSizes) : null;
  const reachedStart = positions.some((position) => Math.abs(position.actual - 0) <= 2);
  const reachedEnd = positions.some((position) => Math.abs(position.actual - finalBounds.maxLogicalPosition) <= 2);
  const reliableCoverage = declaredSize !== null && discoveredKeys.size >= declaredSize;
  const complete = reliableCoverage && reachedStart && reachedEnd;

  const restored = await restoreUserState({
    adapter,
    scrollContainer,
    state: before,
    document: documentRef,
    window: windowRef
  });
  const after = captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef });
  const restoreDelta = Math.abs(after.logicalPosition - before.logicalPosition);
  const composerPreserved = before.composerText === after.composerText;
  const focusPreserved = before.activeElement === after.activeElement;
  const selectionPreserved = selectionsEqual(before.selection, after.selection);
  const noPersistentObserver = true;
  const pass = complete && restored && restoreDelta <= 2 && composerPreserved && focusPreserved && selectionPreserved && noPersistentObserver;

  const failureReasons = [];
  if (!reliableCoverage) failureReasons.push("no-reliable-total-turn-metadata");
  if (!reachedStart || !reachedEnd) failureReasons.push("virtual-scroll-range-not-confirmed");
  if (restoreDelta > 2) failureReasons.push(`scroll-restore-delta-${restoreDelta.toFixed(2)}px`);
  if (!composerPreserved) failureReasons.push("composer-content-changed");
  if (!focusPreserved) failureReasons.push("focus-not-restored");
  if (!selectionPreserved) failureReasons.push("selection-not-restored");

  return {
    pass,
    mode: pass ? "full" : "progressive",
    startedAt,
    completedAt: Date.now(),
    evidence: {
      initialBounds,
      finalBounds,
      flexDirection: initialBounds.flexDirection,
      isColumnReverse: initialBounds.isColumnReverse,
      renderedTurnCountAtStart: initialRenderedTurns.length,
      discoveredUserTurnCount: discoveredKeys.size,
      declaredSize,
      metadata: [...metadata.values()],
      positions,
      reachedStart,
      reachedEnd,
      restoreDelta,
      composerPreserved,
      focusPreserved,
      selectionPreserved,
      noPersistentObserver
    },
    failureReasons
  };
}

export function captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef } = {}) {
  const selection = captureSelection(documentRef, windowRef);
  return {
    logicalPosition: adapter?.getLogicalScrollPosition?.() ?? 0,
    physicalScrollTop: scrollContainer?.scrollTop ?? 0,
    activeElement: documentRef?.activeElement ?? null,
    selection,
    composerText: readEditorText(editor)
  };
}

export async function restoreUserState({ adapter, scrollContainer, state, document: documentRef, window: windowRef } = {}) {
  if (!state) return false;
  adapter?.setLogicalScrollPosition?.(state.logicalPosition, { behavior: "auto", container: scrollContainer });
  await settle(windowRef, 0);
  if (state.activeElement && state.activeElement.isConnected !== false) {
    state.activeElement.focus?.();
  }
  restoreSelection(documentRef, windowRef, state.selection);
  return true;
}

function buildScanTargets(maxLogicalPosition, step, maxSteps, initialPosition) {
  const max = Math.max(0, maxLogicalPosition);
  const targets = [0];
  for (let position = step; position < max && targets.length < maxSteps - 1; position += step) {
    targets.push(position);
  }
  targets.push(max);
  if (Number.isFinite(initialPosition) && !targets.some((target) => Math.abs(target - initialPosition) <= 0.5)) {
    targets.push(initialPosition);
  }
  return [...new Set(targets)];
}

function captureSelection(documentRef, windowRef) {
  const selection = windowRef?.getSelection?.() ?? documentRef?.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    range: typeof range.cloneRange === "function" ? range.cloneRange() : null
  };
}

function restoreSelection(documentRef, windowRef, selectionState) {
  if (!selectionState || !selectionState.anchorNode || !selectionState.focusNode) return false;
  if (selectionState.anchorNode.isConnected === false || selectionState.focusNode.isConnected === false) return false;
  const selection = windowRef?.getSelection?.() ?? documentRef?.getSelection?.();
  if (!selection) return false;
  try {
    selection.removeAllRanges();
    if (selectionState.range) selection.addRange(selectionState.range);
    if (typeof selection.setBaseAndExtent === "function") {
      selection.setBaseAndExtent(
        selectionState.anchorNode,
        selectionState.anchorOffset,
        selectionState.focusNode,
        selectionState.focusOffset
      );
    }
    return true;
  } catch {
    return false;
  }
}

function selectionsEqual(left, right) {
  if (!left || !right) return left === right;
  return left.anchorNode === right.anchorNode
    && left.anchorOffset === right.anchorOffset
    && left.focusNode === right.focusNode
    && left.focusOffset === right.focusOffset;
}

async function settle(windowRef, milliseconds) {
  if (milliseconds <= 0) {
    await Promise.resolve();
    return;
  }
  await new Promise((resolve) => {
    const setTimer = windowRef?.setTimeout ?? setTimeout;
    setTimer(resolve, milliseconds);
  });
}

function failedSpike(reason, startedAt) {
  return {
    pass: false,
    mode: "progressive",
    startedAt,
    completedAt: Date.now(),
    evidence: {
      initialBounds: null,
      finalBounds: null,
      flexDirection: null,
      isColumnReverse: null,
      renderedTurnCountAtStart: 0,
      discoveredUserTurnCount: 0,
      declaredSize: null,
      metadata: [],
      positions: [],
      reachedStart: false,
      reachedEnd: false,
      restoreDelta: null,
      composerPreserved: null,
      focusPreserved: null,
      selectionPreserved: null,
      noPersistentObserver: true
    },
    failureReasons: [reason]
  };
}
