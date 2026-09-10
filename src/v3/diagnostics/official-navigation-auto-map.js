const MARKER_SELECTOR = "[data-thread-user-message-navigation-item-id]";

export function analyzeOfficialNavigationAutoMap({ document, turns = [], resolveMarkerKey = null, minCoverage = 0.8 } = {}) {
  const buttons = Array.from(document?.querySelectorAll?.(MARKER_SELECTOR) ?? []);
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.id && Number.isFinite(turn?.order))
    .map((turn) => ({
      id: String(turn.id),
      order: Number(turn.order),
      text: normalizeText(turn.text),
      shortText: normalizeText(turn.shortText ?? turn.text)
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const orderById = new Map(orderedTurns.map((turn) => [turn.id, turn.order]));
  const uniqueTextOrders = buildUniqueTextOrders(orderedTurns);
  const markerCandidates = [];
  const strategyCounts = { domReference: 0, explicitLabel: 0, textMatch: 0, sequenceGap: 0 };
  let markerConflicts = 0;

  buttons.forEach((button, markerIndex) => {
    const markerKey = String(button?.getAttribute?.("data-thread-user-message-navigation-item-id") ?? "").trim();
    if (!markerKey) return;
    const candidates = new Map();
    const add = (order, strategy) => {
      if (!Number.isInteger(order) || order < 0 || order >= orderedTurns.length) return;
      const strategies = candidates.get(order) ?? new Set();
      strategies.add(strategy);
      candidates.set(order, strategies);
    };

    if (typeof resolveMarkerKey === "function") {
      const resolvedId = resolveMarkerKey(markerKey);
      const resolvedOrder = orderById.get(String(resolvedId ?? ""));
      if (Number.isInteger(resolvedOrder)) add(resolvedOrder, "domReference");
    }

    const texts = readMarkerTexts(button);
    for (const text of texts) {
      const explicitOrder = parseExplicitQuestionOrder(text, orderedTurns.length);
      if (Number.isInteger(explicitOrder)) add(explicitOrder, "explicitLabel");
      const normalized = normalizeText(text);
      const textOrder = uniqueTextOrders.get(normalized);
      if (Number.isInteger(textOrder)) add(textOrder, "textMatch");
      if (normalized.length >= 6) {
        for (const turn of orderedTurns) {
          const candidateText = turn.shortText || turn.text;
          if (candidateText.length >= 6 && normalized.endsWith(candidateText)) add(turn.order, "textMatch");
        }
      }
    }

    if (candidates.size !== 1) {
      if (candidates.size > 1) markerConflicts += 1;
      return;
    }
    const [[targetOrder, strategies]] = candidates.entries();
    for (const strategy of strategies) strategyCounts[strategy] += 1;
    markerCandidates.push({ markerIndex, markerKey, targetOrder, strategies: [...strategies].sort() });
  });

  const byTarget = new Map();
  for (const pair of markerCandidates) {
    const list = byTarget.get(pair.targetOrder) ?? [];
    list.push(pair);
    byTarget.set(pair.targetOrder, list);
  }
  const targetConflicts = [...byTarget.values()].filter((list) => list.length > 1).length;
  let pairs = markerCandidates
    .filter((pair) => (byTarget.get(pair.targetOrder)?.length ?? 0) === 1)
    .sort((a, b) => a.markerIndex - b.markerIndex);
  const directMonotonic = pairs.every((pair, index) => index === 0 || pair.targetOrder > pairs[index - 1].targetOrder);
  if (directMonotonic && markerConflicts === 0 && targetConflicts === 0) {
    const anchors = [{ markerIndex: -1, targetOrder: -1 }, ...pairs, { markerIndex: buttons.length, targetOrder: orderedTurns.length }];
    const occupiedMarkers = new Set(pairs.map((pair) => pair.markerIndex));
    const occupiedTargets = new Set(pairs.map((pair) => pair.targetOrder));
    const inferred = [];
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const left = anchors[i];
      const right = anchors[i + 1];
      const markerGap = right.markerIndex - left.markerIndex - 1;
      const targetGap = right.targetOrder - left.targetOrder - 1;
      if (markerGap <= 0 || markerGap !== targetGap) continue;
      for (let offset = 1; offset <= markerGap; offset += 1) {
        const markerIndex = left.markerIndex + offset;
        const targetOrder = left.targetOrder + offset;
        if (occupiedMarkers.has(markerIndex) || occupiedTargets.has(targetOrder)) continue;
        const button = buttons[markerIndex];
        const markerKey = String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim();
        if (!markerKey) continue;
        inferred.push({ markerIndex, markerKey, targetOrder, strategies: ['sequenceGap'] });
        occupiedMarkers.add(markerIndex);
        occupiedTargets.add(targetOrder);
      }
    }
    if (inferred.length) {
      strategyCounts.sequenceGap += inferred.length;
      pairs = [...pairs, ...inferred].sort((a, b) => a.markerIndex - b.markerIndex);
    }
  }
  const monotonic = pairs.every((pair, index) => index === 0 || pair.targetOrder > pairs[index - 1].targetOrder);
  const mappedTargetCount = new Set(pairs.map((pair) => pair.targetOrder)).size;
  const knownTurnCount = orderedTurns.length;
  const coverage = knownTurnCount > 0 ? mappedTargetCount / knownTurnCount : 0;
  const readyCandidate = buttons.length > 0
    && knownTurnCount >= 5
    && markerConflicts === 0
    && targetConflicts === 0
    && monotonic
    && mappedTargetCount >= 5
    && coverage >= Math.max(0.5, Math.min(1, Number(minCoverage) || 0.8));

  return {
    privatePairs: pairs,
    summary: {
      markerCount: buttons.length,
      knownTurnCount,
      mappedTargetCount,
      coverage: roundRatio(coverage),
      markerConflicts,
      targetConflicts,
      monotonic,
      strategyCounts,
      readyCandidate,
      recommendedMode: readyCandidate ? "auto-official-candidate" : "fallback-self"
    }
  };
}

export function sanitizeOfficialNavigationAutoSummary(value = {}) {
  const strategies = value?.strategyCounts ?? {};
  return {
    status: typeof value?.status === "string" ? value.status : "idle",
    markerCount: nonNegativeInt(value?.markerCount),
    knownTurnCount: nonNegativeInt(value?.knownTurnCount),
    mappedTargetCount: nonNegativeInt(value?.mappedTargetCount),
    coverage: roundRatio(value?.coverage),
    markerConflicts: nonNegativeInt(value?.markerConflicts),
    targetConflicts: nonNegativeInt(value?.targetConflicts),
    monotonic: Boolean(value?.monotonic),
    stableScans: nonNegativeInt(value?.stableScans),
    strategyCounts: {
      domReference: nonNegativeInt(strategies.domReference),
      explicitLabel: nonNegativeInt(strategies.explicitLabel),
      textMatch: nonNegativeInt(strategies.textMatch),
      sequenceGap: nonNegativeInt(strategies.sequenceGap)
    },
    recommendedMode: typeof value?.recommendedMode === "string" ? value.recommendedMode : "fallback-self"
  };
}

export function officialAutoMapSignature(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => `${Number(pair?.targetOrder)}\u0000${String(pair?.markerKey ?? "")}`)
    .sort()
    .join("\u0001");
}

function readMarkerTexts(button) {
  const values = [
    button?.getAttribute?.("aria-label"),
    button?.getAttribute?.("aria-description"),
    button?.getAttribute?.("title"),
    button?.innerText,
    button?.textContent
  ];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function parseExplicitQuestionOrder(text, knownTurnCount) {
  const value = String(text ?? "").trim();
  const patterns = [
    /\bQ\s*([1-9]\d*)\b/i,
    /\bQuestion\s*([1-9]\d*)\b/i,
    /问题\s*([1-9]\d*)/i,
    /第\s*([1-9]\d*)\s*(?:个)?(?:问题|提问)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const number = Number.parseInt(match[1], 10);
    if (Number.isInteger(number) && number >= 1 && number <= knownTurnCount) return number - 1;
  }
  return null;
}

function buildUniqueTextOrders(turns) {
  const map = new Map();
  const ambiguous = new Set();
  for (const turn of turns) {
    for (const text of [turn.text, turn.shortText]) {
      if (!text || text.length < 3) continue;
      if (map.has(text) && map.get(text) !== turn.order) {
        ambiguous.add(text);
        map.delete(text);
      } else if (!ambiguous.has(text)) {
        map.set(text, turn.order);
      }
    }
  }
  return map;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function nonNegativeInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function roundRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
}
