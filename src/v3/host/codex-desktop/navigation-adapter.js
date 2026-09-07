import { clamp, createScrollModel, scrollTopFromLogical } from "../../core/scroll-model.js";

const FALLBACK_TURN = /^fallback-turn-(\d+)$/;
const HYDRATION_ATTRIBUTES = [
  "data-turn-key",
  "data-content-search-turn-key",
  "data-turn-id",
  "data-turn-id-container"
];

export class NavigationAdapter {
  constructor({
    window,
    turnAdapter,
    conversationAdapter,
    activationOffset = 120,
    maxHydrationSteps = 256,
    maxConsecutiveStalls = 4,
    hydrationWaitMs = 900,
    workWheelStepPx = 720,
    workWheelWaitMs = 220,
    inactivityNavigationMs = 5000,
    absoluteMaxNavigationMs = 45000,
    maxNavigationMs = null,
    motionProgressWaitMs = 45,
    maxAlignFrames = 8,
    postSettleWaitMs = 160,
    maxPostSettleCorrections = 2
  } = {}) {
    this.window = window ?? globalThis.window;
    this.turnAdapter = turnAdapter;
    this.conversationAdapter = conversationAdapter;
    this.activationOffset = activationOffset;
    this.maxHydrationSteps = maxHydrationSteps;
    this.maxConsecutiveStalls = maxConsecutiveStalls;
    this.hydrationWaitMs = hydrationWaitMs;
    this.workWheelStepPx = workWheelStepPx;
    this.workWheelWaitMs = workWheelWaitMs;
    this.inactivityNavigationMs = inactivityNavigationMs;
    this.absoluteMaxNavigationMs = Number.isFinite(maxNavigationMs)
      ? Number(maxNavigationMs)
      : Number(absoluteMaxNavigationMs);
    this.motionProgressWaitMs = motionProgressWaitMs;
    this.maxAlignFrames = maxAlignFrames;
    this.postSettleWaitMs = postSettleWaitMs;
    this.maxPostSettleCorrections = maxPostSettleCorrections;
    this.compatibility = createNavigationCompatibility();
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true } = {}) {
    if (!turnId) return failure("missing-turn-id", turnId);
    if (!isCurrent()) return failure("superseded", turnId);
    const readTurns = () => {
      try {
        const current = typeof getTurns === "function" ? getTurns() : turns;
        return Array.isArray(current) ? current : turns;
      } catch {
        return turns;
      }
    };
    const getIndexState = () => createNavigationIndex(turnId, readTurns());
    let indexState = getIndexState();
    if (indexState.targetIndex < 0) return failure("unknown-turn", turnId);

    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return failure("missing-scroll-container", turnId);
    const isNavigationCurrent = () => isCurrent() && this.conversationAdapter.getScrollContainer() === container;
    if (!isNavigationCurrent()) return failure("superseded", turnId);

    this.compatibility = createNavigationCompatibility();
    const startedAt = nowMs(this.window);
    let lastProgressAt = startedAt;
    let probes = 0;
    let consecutiveStalls = 0;
    let workCompatibilityNotified = false;
    let snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    let candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    const readTargetOrder = () => getIndexState().targetOrder;
    const readMaxKnownOrder = () => getIndexState().maxKnownOrder;
    if (candidate) {
      lastProgressAt = nowMs(this.window);
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
      indexState = getIndexState();
      snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    }

    while (probes < this.maxHydrationSteps && nowMs(this.window) - startedAt < this.absoluteMaxNavigationMs) {
      const loopNow = nowMs(this.window);
      if (loopNow - lastProgressAt >= this.inactivityNavigationMs) {
        return this.navigationFailure("navigation-inactive", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
          inactiveMs: Math.round(loopNow - lastProgressAt)
        });
      }
      if (!isNavigationCurrent()) return failure("superseded", turnId);

      const refreshedIndex = getIndexState();
      if (refreshedIndex.targetIndex < 0) return failure("unknown-turn", turnId);
      if (refreshedIndex.signature !== indexState.signature) {
        indexState = refreshedIndex;
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      } else {
        indexState = refreshedIndex;
      }
      const { targetOrder, orderById, maxKnownOrder } = indexState;

      candidate = this.resolveCandidate(turnId, targetOrder);
      if (candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }

      const model = readScrollModel(container, this.window);
      const visibleOrders = this.readVisibleOrders(orderById);
      const currentSnapshot = createHydrationSnapshot(targetOrder, visibleOrders, model);
      const direction = chooseHydrationDirection(targetOrder, visibleOrders, model);
      if (hasHydrationProgress(targetOrder, snapshot, currentSnapshot, direction)) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      }
      snapshot = currentSnapshot;

      const targetBeforeVisible = visibleOrders.length > 0 && targetOrder < visibleOrders[0];
      const reverseEarlier = model.isColumnReverse && direction < 0 && targetBeforeVisible;

      if (reverseEarlier) {
        if (!workCompatibilityNotified) {
          workCompatibilityNotified = true;
          this.notifyCodexPlusScrollIntent(container, isNavigationCurrent);
        }
        const outcome = await this.performWorkWheelHydrationStep({
          turnId,
          targetOrder,
          previousSnapshot: currentSnapshot,
          container,
          isCurrent: isNavigationCurrent,
          orderById,
          turnCount: indexState.turns.length,
          getIndexState
        });
        if (outcome.state === "superseded") return failure("superseded", turnId);
        probes += outcome.moved ? 1 : 0;
        const nextIndex = getIndexState();
        if (nextIndex.signature !== indexState.signature) {
          lastProgressAt = nowMs(this.window);
          consecutiveStalls = 0;
        }
        indexState = nextIndex;
        snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        if (outcome.candidate) {
          lastProgressAt = nowMs(this.window);
          const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
          consecutiveStalls = 0;
          indexState = getIndexState();
          snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
          continue;
        }
        if (outcome.progressed || outcome.moved) {
          consecutiveStalls = 0;
          lastProgressAt = nowMs(this.window);
          continue;
        }
        return this.navigationFailure("work-wheel-stalled", turnId, {
          probes, stalls: 1, container, startedAt, getIndexState
        });
      }

      const computedJump = hydrationStepSize(model, visibleOrders, targetOrder);
      const nudgeScale = consecutiveStalls > 0 ? 0.42 : 1;
      const jump = Math.max(
        Math.min(computedJump * nudgeScale, model.maxLogicalPosition || computedJump),
        Math.min(180, model.clientHeight || 180)
      );
      const regularNextLogical = clamp(
        model.logicalPosition + direction * jump,
        model.minLogicalPosition,
        model.maxLogicalPosition
      );
      const endpointLogical = model.isColumnReverse && targetOrder === maxKnownOrder && direction > 0
        ? model.maxLogicalPosition
        : null;
      const nextLogical = endpointLogical == null ? regularNextLogical : endpointLogical;
      const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
      const outcome = await this.awaitHydrationProgress({
        turnId,
        targetOrder,
        previousSnapshot: currentSnapshot,
        direction,
        container,
        isCurrent: isNavigationCurrent,
        orderById,
        getIndexState,
        waitMs: this.hydrationWaitMs,
        allowMotionProgress: true,
        scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
      });
      if (outcome.state === "superseded") return failure("superseded", turnId);
      probes += moved ? 1 : 0;
      const nextIndex = getIndexState();
      if (nextIndex.signature !== indexState.signature) {
        lastProgressAt = nowMs(this.window);
        consecutiveStalls = 0;
      }
      indexState = nextIndex;
      snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);

      if (outcome.candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }
      if (outcome.progressed) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
        continue;
      }

      consecutiveStalls += 1;
      if (consecutiveStalls >= this.maxConsecutiveStalls) {
        indexState = getIndexState();
        candidate = this.resolveCandidate(turnId, indexState.targetOrder);
        if (candidate) {
          const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
        }
        return this.navigationFailure("hydration-stalled", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState
        });
      }
    }

    indexState = getIndexState();
    candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    if (candidate) {
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
    }
    return this.navigationFailure("navigation-hard-limit", turnId, {
      probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
      budgetLimit: probes >= this.maxHydrationSteps ? "probes" : "absolute-time"
    });
  }

  navigationFailure(reason, turnId, { probes = 0, stalls = 0, targetOrder = -1, orderById = null, container, startedAt, getIndexState = null, ...extra } = {}) {
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const latest = this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById);
    return {
      ...failure(reason, turnId),
      probes, stalls,
      targetOrder: currentTargetOrder,
      visibleRange: latest.visibleRange,
      scrollHeight: latest.scrollHeight,
      maxLogicalPosition: latest.maxLogicalPosition,
      logicalPosition: latest.logicalPosition,
      elapsedMs: Math.round(nowMs(this.window) - startedAt),
      ...extra
    };
  }

  async awaitHydrationProgress({ turnId, targetOrder, previousSnapshot, direction, container, isCurrent, orderById = null, getIndexState = null, waitMs = this.hydrationWaitMs, allowMotionProgress = true, scrollAction = null }) {
    const initialIndex = typeof getIndexState === "function" ? getIndexState() : null;
    const initialTargetOrder = Number.isFinite(initialIndex?.targetOrder) ? Number(initialIndex.targetOrder) : targetOrder;
    const initialOrderById = initialIndex?.orderById ?? orderById;
    const baselineSignature = initialIndex?.signature ?? null;
    const baseline = previousSnapshot ?? this.readHydrationSnapshot(container, initialTargetOrder, initialOrderById);
    let observer = null;
    let timer = null;
    let motionTimer = null;
    let rafId = null;
    let rafChecks = 0;
    let settled = false;
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { observer?.disconnect?.(); } catch {}
      if (timer != null) clearTimer(this.window, timer);
      if (motionTimer != null) clearTimer(this.window, motionTimer);
      if (rafId != null) this.window?.cancelAnimationFrame?.(rafId);
      resolvePromise(value);
    };
    const readIndex = () => typeof getIndexState === "function" ? getIndexState() : null;
    const readCurrentSnapshot = () => {
      const indexState = readIndex();
      const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
      const currentOrderById = indexState?.orderById ?? orderById;
      return {
        indexState,
        targetOrder: currentTargetOrder,
        snapshot: this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById)
      };
    };
    const evaluate = ({ allowMotionProgress = false } = {}) => {
      if (settled) return true;
      if (!isCurrent()) {
        const current = readCurrentSnapshot();
        finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
        return true;
      }
      const current = readCurrentSnapshot();
      const candidate = this.resolveCandidate(turnId, current.targetOrder);
      if (candidate) {
        finish({ state: "target", progressed: true, candidate, snapshot: current.snapshot });
        return true;
      }
      if (baselineSignature != null && current.indexState?.signature != null && current.indexState.signature !== baselineSignature) {
        finish({ state: "progress", progressed: true, indexChanged: true, snapshot: current.snapshot });
        return true;
      }
      if (hasHydrationProgress(current.targetOrder, baseline, current.snapshot, direction, { allowMotionProgress })) {
        finish({ state: "progress", progressed: true, snapshot: current.snapshot });
        return true;
      }
      return false;
    };

    const MutationObserverCtor = this.window?.MutationObserver;
    if (typeof MutationObserverCtor === "function" && container) {
      try {
        observer = new MutationObserverCtor(() => {
          evaluate({ allowMotionProgress: false });
        });
        observer.observe(container, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: HYDRATION_ATTRIBUTES
        });
      } catch {
        observer = null;
      }
    }

    const scheduleFrameCheck = () => {
      if (settled || rafChecks >= 36 || typeof this.window?.requestAnimationFrame !== "function") return;
      rafChecks += 1;
      rafId = this.window.requestAnimationFrame(() => {
        rafId = null;
        if (!evaluate({ allowMotionProgress: false })) scheduleFrameCheck();
      });
    };

    if (allowMotionProgress) {
      motionTimer = setTimer(this.window, () => {
        motionTimer = null;
        evaluate({ allowMotionProgress: true });
      }, this.motionProgressWaitMs);
    }

    timer = setTimer(this.window, () => {
      if (evaluate({ allowMotionProgress })) return;
      const current = readCurrentSnapshot();
      finish({ state: "stalled", progressed: false, snapshot: current.snapshot });
    }, Math.max(0, Number(waitMs) || 0));
    if (!isCurrent()) {
      const current = readCurrentSnapshot();
      finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
      return promise;
    }
    try { scrollAction?.(); } catch {}
    evaluate({ allowMotionProgress: false });
    scheduleFrameCheck();
    return promise;
  }

  async performWorkWheelHydrationStep({ turnId, targetOrder, previousSnapshot, container, isCurrent, orderById, turnCount = 0, getIndexState = null }) {
    if (!container || !isCurrent()) return { state: "superseded", progressed: false, moved: false };
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const currentTurnCount = Array.isArray(indexState?.turns) ? indexState.turns.length : turnCount;
    const model = readScrollModel(container, this.window);
    const viewport = Math.max(240, Number(model.clientHeight) || 737);
    const configuredStep = Math.min(Math.max(240, Number(this.workWheelStepPx) || 720), viewport);
    const step = Number(currentTurnCount) <= 12 ? Math.max(180, Math.min(configuredStep, viewport * 0.5)) : configuredStep;
    const nextLogical = clamp(model.logicalPosition - step, model.minLogicalPosition, model.maxLogicalPosition);
    const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
    dispatchWheelEvent(container, this.window, -step);
    const outcome = await this.awaitHydrationProgress({
      turnId,
      targetOrder: currentTargetOrder,
      previousSnapshot,
      direction: -1,
      container,
      isCurrent,
      orderById: currentOrderById,
      getIndexState,
      waitMs: moved ? this.workWheelWaitMs : this.hydrationWaitMs,
      allowMotionProgress: false,
      scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
    });
    return { ...outcome, moved };
  }

  notifyCodexPlusScrollIntent(container, isCurrent = () => true) {
    if (!container || !isCurrent()) {
      this.compatibility = { ...createNavigationCompatibility(), status: "superseded" };
      return false;
    }
    const handlers = this.window?.__codexThreadScrollHandlers;
    const markPointerIntent = handlers?.markPointerIntent;
    if (typeof markPointerIntent !== "function") {
      this.compatibility = { ...createNavigationCompatibility(), status: "unavailable" };
      return false;
    }
    try {
      markPointerIntent.call(handlers, { target: container, type: "pointerdown" });
      this.compatibility = { ...createNavigationCompatibility(), status: "available", notified: true };
      return true;
    } catch (error) {
      this.compatibility = { ...createNavigationCompatibility(), status: "error", error: String(error?.message ?? error ?? "unknown") };
      return false;
    }
  }

  getCompatibilityStatus() {
    return { ...this.compatibility };
  }

  readVisibleOrders(orderById = null) {
    const values = [];
    for (const turn of this.turnAdapter.getVisibleTurns?.() ?? []) {
      const canonicalOrder = orderById?.get?.(String(turn?.id ?? ""));
      const order = Number.isFinite(canonicalOrder)
        ? Number(canonicalOrder)
        : Number.isFinite(turn?.order) ? Number(turn.order) : fallbackOrder(turn?.id);
      if (Number.isFinite(order)) values.push(order);
    }
    return [...new Set(values)].sort((a, b) => a - b);
  }

  readHydrationSnapshot(container, targetOrder, orderById = null) {
    return createHydrationSnapshot(targetOrder, this.readVisibleOrders(orderById), readScrollModel(container, this.window));
  }

  resolveCandidate(turnId, targetOrder = -1) {
    const direct = this.turnAdapter.resolveTurn(turnId);
    if (direct && this.turnAdapter.verifyTurnElement(turnId, direct)) return { element: direct, domId: turnId };
    if (!Number.isFinite(targetOrder) || targetOrder < 0) return null;
    const fallbackId = `fallback-turn-${targetOrder}`;
    if (fallbackId === turnId) return null;
    const fallback = this.turnAdapter.resolveTurn(fallbackId);
    if (fallback && this.turnAdapter.verifyTurnElement(fallbackId, fallback)) return { element: fallback, domId: fallbackId };
    return null;
  }

  async verifyAndAlign(turnId, candidateOrElement, isCurrent, probes, targetOrder = -1, maxKnownOrder = null) {
    if (!isCurrent()) return failure("superseded", turnId);
    const readTargetOrder = typeof targetOrder === "function" ? targetOrder : () => targetOrder;
    const readMaxKnownOrder = typeof maxKnownOrder === "function" ? maxKnownOrder : () => maxKnownOrder;
    let candidate = candidateOrElement?.element
      ? candidateOrElement
      : { element: candidateOrElement, domId: turnId };
    if (!this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) return failure("stale-or-recycled-dom", turnId);
    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return failure("missing-scroll-container", turnId);

    const alignCandidate = async () => {
      for (let frame = 0; frame < this.maxAlignFrames; frame += 1) {
        if (!isCurrent()) return failure("superseded", turnId);
        candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
        if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
          return failure("stale-or-recycled-dom", turnId);
        }
        const rect = candidate.element.getBoundingClientRect?.();
        const containerRect = container.getBoundingClientRect?.();
        if (!rect || !containerRect) break;
        const activationLine = containerRect.top + this.activationOffset;
        const delta = rect.top - activationLine;
        if (Math.abs(delta) <= 5) break;
        const model = readScrollModel(container, this.window);
        const logicalTarget = clamp(
          model.logicalPosition + delta,
          model.minLogicalPosition,
          model.maxLogicalPosition
        );
        if (Math.abs(logicalTarget - model.logicalPosition) < 1) break;
        setLogicalScrollPosition(container, logicalTarget, model);
        await nextFrame(this.window);
      }
      return null;
    };

    const firstAlignmentFailure = await alignCandidate();
    if (firstAlignmentFailure) return firstAlignmentFailure;

    for (let settleCheck = 0; settleCheck <= this.maxPostSettleCorrections; settleCheck += 1) {
      await nextFrame(this.window);
      if (!isCurrent()) return failure("superseded", turnId);
      candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
      if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
        return { ...failure("post-settle-target-lost", turnId), probes, settleChecks: settleCheck };
      }
      const rect = candidate.element.getBoundingClientRect?.();
      const containerRect = container.getBoundingClientRect?.();
      if (!rect || !containerRect) return { ...failure("verification-failed", turnId), probes };
      const model = readScrollModel(container, this.window);
      if (isVerifiedTailEndpoint({
        targetOrder: readTargetOrder(),
        maxKnownOrder: readMaxKnownOrder(),
        rect,
        containerRect,
        model
      })) {
        return {
          ok: true,
          target: turnId,
          targetOrder: readTargetOrder(),
          verified: true,
          probes,
          domId: candidate.domId,
          settleChecks: settleCheck + 1,
          endpoint: "tail"
        };
      }
      if (!rectInActivationZone(rect, containerRect, this.activationOffset)) {
        if (settleCheck >= this.maxPostSettleCorrections) {
          return { ...failure("post-settle-drift", turnId), probes, settleChecks: settleCheck + 1 };
        }
        const correctionFailure = await alignCandidate();
        if (correctionFailure) return correctionFailure;
      }
      if (settleCheck < this.maxPostSettleCorrections && this.postSettleWaitMs > 0) {
        await delay(this.window, this.postSettleWaitMs);
        continue;
      }
      return {
        ok: true,
        target: turnId,
        targetOrder: readTargetOrder(),
        verified: true,
        probes,
        domId: candidate.domId,
        settleChecks: settleCheck + 1
      };
    }

    return { ...failure("post-settle-drift", turnId), probes };
  }

  async verifyAndCenter(...args) {
    return this.verifyAndAlign(...args);
  }
}

function createNavigationIndex(turnId, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const targetIndex = list.findIndex((turn) => turn?.id === turnId);
  const targetRecord = targetIndex >= 0 ? list[targetIndex] : null;
  const targetOrder = Number.isFinite(targetRecord?.order) ? Number(targetRecord.order) : targetIndex;
  const orderById = createTurnOrderMap(list);
  const knownOrders = [...orderById.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const maxKnownOrder = knownOrders.at(-1) ?? null;
  const signature = list.map((turn, index) => {
    const order = Number.isFinite(turn?.order) ? Number(turn.order) : index;
    return `${String(turn?.id ?? "")}:${order}`;
  }).join("|");
  return { turns: list, targetIndex, targetOrder, orderById, maxKnownOrder, signature };
}

function createTurnOrderMap(turns = []) {
  const values = new Map();
  for (const [index, turn] of turns.entries()) {
    if (!turn?.id) continue;
    const order = Number.isFinite(turn.order) ? Number(turn.order) : index;
    values.set(String(turn.id), order);
  }
  return values;
}

export function computeActiveTurnId({ visibleTurns = [], resolveTurn, container = null, activationOffset = 120 } = {}) {
  const containerRect = container?.getBoundingClientRect?.() ?? { top: 0, bottom: Number.POSITIVE_INFINITY, height: 800 };
  const activationLine = containerRect.top + activationOffset;
  let crossed = null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const turn of visibleTurns) {
    const rect = resolveTurn?.(turn.id)?.getBoundingClientRect?.();
    if (!rect || rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
    const distance = Math.abs(rect.top - activationLine);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = turn.id;
    }
    if (rect.top <= activationLine && rect.bottom > activationLine) crossed = turn.id;
  }
  return crossed ?? nearest ?? null;
}

function isVerifiedTailEndpoint({ targetOrder, maxKnownOrder, rect, containerRect, model, tolerance = 2 } = {}) {
  if (!Number.isFinite(targetOrder) || !Number.isFinite(maxKnownOrder) || targetOrder !== maxKnownOrder) return false;
  if (!model?.isColumnReverse) return false;
  if (Math.abs(Number(model.maxLogicalPosition || 0) - Number(model.logicalPosition || 0)) > tolerance) return false;
  if (!rect || !containerRect) return false;
  return Number(rect.bottom) > Number(containerRect.top) && Number(rect.top) < Number(containerRect.bottom);
}

export function rectInActivationZone(rect, containerRect = null, activationOffset = 120) {
  if (!rect) return false;
  const bounds = containerRect ?? { top: 0, bottom: 800, height: 800 };
  const height = Number(bounds.height) || Math.max(1, Number(bounds.bottom) - Number(bounds.top)) || 800;
  const line = Number(bounds.top || 0) + activationOffset;
  const tolerance = Math.min(42, Math.max(18, height * 0.045));
  return rect.top <= line + tolerance && rect.bottom >= line - tolerance;
}

export function readScrollModel(container, windowRef = globalThis.window) {
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  return createScrollModel({
    scrollTop: container?.scrollTop,
    scrollHeight: container?.scrollHeight,
    clientHeight: container?.clientHeight,
    flexDirection
  });
}

export function setLogicalScrollPosition(container, logicalPosition, model = readScrollModel(container)) {
  if (!container) return null;
  const top = scrollTopFromLogical(logicalPosition, model.maxLogicalPosition, model.isColumnReverse);
  container.scrollTop = top;
  return top;
}

export function chooseHydrationDirection(targetOrder, visibleOrders = [], model = {}) {
  if (visibleOrders.length) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    if (targetOrder < min) return -1;
    if (targetOrder > max) return 1;
  }
  const midpoint = (Number(model.minLogicalPosition || 0) + Number(model.maxLogicalPosition || 0)) / 2;
  return Number(model.logicalPosition || 0) > midpoint ? -1 : 1;
}

export function hydrationStepSize(model = {}, visibleOrders = [], targetOrder = -1) {
  const viewport = Math.max(1, Number(model.clientHeight) || 800);
  const span = Math.max(viewport, Number(model.maxLogicalPosition) || viewport);
  let multiplier = 1.45;
  if (visibleOrders.length && Number.isFinite(targetOrder)) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    const distance = targetOrder < min ? min - targetOrder : targetOrder > max ? targetOrder - max : 0;
    if (distance > 20) multiplier = 2.4;
    else if (distance > 8) multiplier = 1.9;
  }
  const proportional = Math.min(3200, Math.max(900, span * 0.06));
  return Math.min(span, Math.max(viewport * multiplier, proportional));
}

export function turnWindowDistance(targetOrder, orders = []) {
  if (!Number.isFinite(targetOrder) || !orders.length) return Number.POSITIVE_INFINITY;
  const sorted = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.POSITIVE_INFINITY;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (targetOrder < min) return min - targetOrder;
  if (targetOrder > max) return targetOrder - max;
  return 0;
}

export function createHydrationSnapshot(targetOrder, orders = [], model = {}) {
  const visibleOrders = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  return {
    visibleOrders,
    visibleRange: visibleOrderRange(visibleOrders),
    targetDistance: turnWindowDistance(targetOrder, visibleOrders),
    scrollHeight: Number(model.scrollHeight) || 0,
    clientHeight: Number(model.clientHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0
  };
}

export function hasHydrationProgress(targetOrder, before, after, direction = 0, { allowMotionProgress = true } = {}) {
  if (!after) return false;
  if (!before) return true;
  if (turnWindowDistance(targetOrder, after.visibleOrders) < turnWindowDistance(targetOrder, before.visibleOrders)) return true;
  if (after.scrollHeight > before.scrollHeight + 1) return true;
  if (after.maxLogicalPosition > before.maxLogicalPosition + 1) return true;
  if (!allowMotionProgress) return false;
  if (direction < 0 && after.logicalPosition < before.logicalPosition - 1) return true;
  if (direction > 0 && after.logicalPosition > before.logicalPosition + 1) return true;
  return false;
}

export function hasTurnWindowProgress(targetOrder, beforeOrders = [], afterOrders = []) {
  return turnWindowDistance(targetOrder, afterOrders) < turnWindowDistance(targetOrder, beforeOrders);
}

export function visibleOrderRange(orders = []) {
  if (!orders.length) return null;
  return { min: orders[0], max: orders[orders.length - 1] };
}

function retryableAlignmentFailure(reason) {
  return reason === "stale-or-recycled-dom"
    || reason === "post-settle-target-lost"
    || reason === "post-settle-drift";
}

function fallbackOrder(id) {
  const match = String(id ?? "").match(FALLBACK_TURN);
  return match ? Number.parseInt(match[1], 10) : null;
}

function dispatchWheelEvent(container, windowRef = globalThis.window, deltaY = -720) {
  if (!container?.dispatchEvent) return false;
  try {
    const WheelCtor = windowRef?.WheelEvent ?? globalThis.WheelEvent;
    const event = typeof WheelCtor === "function"
      ? new WheelCtor("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true })
      : { type: "wheel", deltaY, deltaMode: 0, bubbles: true, cancelable: true };
    container.dispatchEvent(event);
    return true;
  } catch {
    return false;
  }
}


function nextFrame(windowRef) {
  return new Promise((resolve) => {
    if (typeof windowRef?.requestAnimationFrame === "function") windowRef.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function delay(windowRef, milliseconds) {
  return new Promise((resolve) => setTimer(windowRef, resolve, milliseconds));
}

function setTimer(windowRef, callback, delayMs) {
  return typeof windowRef?.setTimeout === "function" ? windowRef.setTimeout(callback, delayMs) : setTimeout(callback, delayMs);
}

function clearTimer(windowRef, timer) {
  if (typeof windowRef?.clearTimeout === "function") windowRef.clearTimeout(timer);
  else clearTimeout(timer);
}

function nowMs(windowRef) {
  return Number(windowRef?.performance?.now?.()) || Date.now();
}

function createNavigationCompatibility() {
  return {
    feature: "codex-plus-thread-scroll-restore",
    status: "not-needed",
    notified: false,
    error: ""
  };
}

function failure(reason, target) {
  return { ok: false, reason, target, verified: false };
}
