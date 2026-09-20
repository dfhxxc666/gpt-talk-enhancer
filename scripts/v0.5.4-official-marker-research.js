/*
@codex-plus-script
name: GTE v0.5.4 Official Marker Research
description: One-shot local research harness for official navigation markers. Idle until manually started.
version: 0.2.8-research
author: local-research
license: UNLICENSED-RESEARCH
*/

(() => {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const W = window;
  const D = document;
  const API = "__GTEV054Research";
  const MARKER = "[data-thread-user-message-navigation-item-id]";
  const STORE = "gte:v054:official-marker-research:latest";
  const REPORT_DB = "gte-v054-research";
  const REPORT_DB_STORE = "handles";
  const REPORT_DIR_KEY = "report-directory";
  const VERSION = "0.2.8-research";
  const DEFAULTS = {
    manualClicks: 7,
    samplesPerMode: 4,
    timeoutMs: 6500,
    settleMs: 260,
    pollMs: 25,
    persist: true,
    autoDownload: false,
    copyClipboard: false
  };

  let current = null;
  let guideDismissed = false;
  let reportDirectoryHandle = null;

  async function chooseReportFile() {
    if (typeof W.showSaveFilePicker !== "function") {
      throw new Error("showSaveFilePicker unavailable in this Codex renderer");
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const handle = await W.showSaveFilePicker({
      suggestedName: "gte-v054-marker-research-" + stamp + ".json",
      types: [{
        description: "JSON report",
        accept: { "application/json": [".json"] }
      }]
    });
    if (!handle) throw new Error("report-file-not-selected");
    return handle;
  }

  async function writeReportHandle(run) {
    if (!run?.reportFileHandle) throw new Error("report-file-handle-missing");
    const writable = await run.reportFileHandle.createWritable();
    await writable.write(JSON.stringify(run, reportJsonReplacer, 2));
    await writable.close();
    run.fileCheckpoint = {
      written: true,
      fileName: run.reportFileName || run.reportFileHandle.name || null,
      at: new Date().toISOString()
    };
    return run.fileCheckpoint;
  }

  function reportJsonReplacer(key, value) {
    if (key === "reportFileHandle" || key === "cleanup" || key === "_checkpointTimer" || key === "_checkpointPromise") return undefined;
    return value;
  }

  function scheduleFileCheckpoint(run) {
    if (!run?.reportFileHandle) return;
    if (run._checkpointTimer) W.clearTimeout(run._checkpointTimer);
    run._checkpointTimer = W.setTimeout(() => {
      run._checkpointTimer = null;
      const previous = run._checkpointPromise || Promise.resolve();
      run._checkpointPromise = previous
        .catch(() => {})
        .then(() => writeReportHandle(run))
        .catch(error => {
          run.fileCheckpoint = {
            written: false,
            fileName: run.reportFileName || null,
            at: new Date().toISOString(),
            error: String(error?.message || error)
          };
          console.error("[GTE v0.5.4] file checkpoint failed", error);
        });
    }, 80);
  }

  async function flushFileCheckpoint(run) {
    if (!run?.reportFileHandle) return null;
    if (run._checkpointTimer) {
      W.clearTimeout(run._checkpointTimer);
      run._checkpointTimer = null;
    }
    if (run._checkpointPromise) {
      try { await run._checkpointPromise; } catch {}
    }
    try {
      return await writeReportHandle(run);
    } catch (error) {
      run.fileCheckpoint = {
        written: false,
        fileName: run.reportFileName || null,
        at: new Date().toISOString(),
        error: String(error?.message || error)
      };
      console.error("[GTE v0.5.4] final file write failed", error);
      return run.fileCheckpoint;
    }
  }

  async function requestReportFile() {
    guideDismissed = false;
    showGuide(
      "v0.5.4 · 选择报告文件",
      "点下面按钮选择一次 JSON 保存位置。测试过程中会持续写入这个文件。"
    );

    return await new Promise((resolve, reject) => {
      const box = D.getElementById("gte-v054-research-guide");
      if (!box) {
        reject(new Error("report-file-guide-missing"));
        return;
      }

      const button = D.createElement("button");
      button.type = "button";
      button.textContent = "选择报告文件并开始";
      Object.assign(button.style, {
        marginTop: "10px",
        padding: "7px 12px",
        border: "1px solid rgba(255,255,255,.22)",
        borderRadius: "8px",
        background: "#2563eb",
        color: "#fff",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: "650"
      });
      box.appendChild(button);

      let settled = false;
      button.addEventListener("click", async ev => {
        ev.preventDefault();
        ev.stopPropagation();
        if (settled) return;
        button.disabled = true;
        button.textContent = "正在打开保存窗口…";
        try {
          const handle = await chooseReportFile();
          settled = true;
          guideDismissed = false;
          showGuide("报告文件已选择", "文件：" + String(handle.name || "(已选择)") + "\n测试即将开始。", "success");
          resolve(handle);
        } catch (error) {
          button.disabled = false;
          button.textContent = "重新选择报告文件";
          guideDismissed = false;
          showGuide("报告文件选择失败", String(error?.message || error) + "\n提示将在 8 秒后自动关闭。", "error");
          hideGuide(8000);
          reject(error);
        }
      });
    });
  }


  function app() {
    return W.__GPTTalkEnhancerV3 || null;
  }

  function now() {
    return W.performance && typeof W.performance.now === "function" ? W.performance.now() : Date.now();
  }

  function sleep(ms) {
    return new Promise(resolve => W.setTimeout(resolve, ms));
  }

  function round(v, n) {
    const x = Number(v);
    if (!Number.isFinite(x)) return null;
    const p = Math.pow(10, n == null ? 3 : n);
    return Math.round(x * p) / p;
  }

  function clone(v) {
    if (v == null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
  }

  function safe(fn, fallback) {
    try {
      const v = fn();
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function rawMarkerId(el) {
    return String(el && el.getAttribute ? el.getAttribute("data-thread-user-message-navigation-item-id") || "" : "").trim();
  }

  function canonicalMarkerId(value) {
    const raw = String(value || "").trim();
    const uuidPrefix = raw.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|$)/i);
    if (uuidPrefix) return uuidPrefix[1];
    const userSuffix = raw.match(/^(.+?):(\d+):user$/);
    return userSuffix ? userSuffix[1] : raw;
  }

  function markerId(el) {
    return canonicalMarkerId(rawMarkerId(el));
  }

  function showGuide(title, detail, tone = "info") {
    if (guideDismissed) return;
    let box = D.getElementById("gte-v054-research-guide");
    if (!box) {
      box = D.createElement("div");
      box.id = "gte-v054-research-guide";
      box.setAttribute("aria-live", "polite");
      Object.assign(box.style, {
        position: "fixed",
        left: "50%",
        top: "20px",
        transform: "translateX(-50%)",
        zIndex: "2147483647",
        width: "min(420px, calc(100vw - 48px))",
        boxSizing: "border-box",
        padding: "14px 44px 14px 16px",
        borderRadius: "12px",
        border: "1px solid rgba(127,127,127,.28)",
        background: "rgba(24,24,27,.94)",
        color: "#fff",
        boxShadow: "0 10px 35px rgba(0,0,0,.28)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: "13px",
        lineHeight: "1.45",
        pointerEvents: "auto"
      });
      D.documentElement.appendChild(box);
    }
    const accent = tone === "error" ? "#fb7185" : tone === "success" ? "#4ade80" : tone === "warn" ? "#fbbf24" : "#60a5fa";
    box.style.borderColor = accent;
    box.innerHTML = "";

    const close = D.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭研究提示");
    Object.assign(close.style, {
      position: "absolute",
      top: "7px",
      right: "8px",
      width: "28px",
      height: "28px",
      padding: "0",
      border: "0",
      borderRadius: "7px",
      background: "transparent",
      color: "#fff",
      fontSize: "22px",
      lineHeight: "26px",
      cursor: "pointer",
      opacity: ".78"
    });
    close.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      guideDismissed = true;
      box.remove();
    });

    const head = D.createElement("div");
    head.textContent = title;
    Object.assign(head.style, { fontWeight: "700", fontSize: "14px", marginBottom: detail ? "5px" : "0" });
    const body = D.createElement("div");
    body.textContent = detail || "";
    Object.assign(body.style, { opacity: ".88", whiteSpace: "pre-line" });
    box.appendChild(close);
    box.appendChild(head);
    if (detail) box.appendChild(body);
    box.style.display = "block";
  }

  function hideGuide(delayMs = 0) {
    const hide = () => {
      const box = D.getElementById("gte-v054-research-guide");
      if (box) box.remove();
    };
    if (delayMs > 0) W.setTimeout(hide, delayMs);
    else hide();
  }

  function markerFromEvent(ev) {
    const path = ev && typeof ev.composedPath === "function" ? ev.composedPath() : [];
    for (const node of path) {
      if (node && node.getAttribute && node.getAttribute("data-thread-user-message-navigation-item-id") != null) return node;
    }
    let node = ev ? ev.target : null;
    while (node) {
      if (node.getAttribute && node.getAttribute("data-thread-user-message-navigation-item-id") != null) return node;
      node = node.parentElement;
    }
    return null;
  }

  function rect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    try {
      const r = el.getBoundingClientRect();
      return {
        top: round(r.top), bottom: round(r.bottom),
        left: round(r.left), right: round(r.right),
        width: round(r.width), height: round(r.height)
      };
    } catch {
      return null;
    }
  }

  function scrollState(container) {
    if (!container) return { present: false };
    const scrollTop = Number(container.scrollTop) || 0;
    const scrollHeight = Number(container.scrollHeight) || 0;
    const clientHeight = Number(container.clientHeight) || 0;
    const flexDirection = safe(() => W.getComputedStyle(container).flexDirection, container.style && container.style.flexDirection || "column");
    const reverse = flexDirection === "column-reverse";
    const max = Math.max(0, scrollHeight - clientHeight);
    const logical = reverse ? Math.min(Math.max(max + scrollTop, 0), max) : Math.min(Math.max(scrollTop, 0), max);
    return {
      present: true,
      scrollTop: round(scrollTop),
      scrollHeight: round(scrollHeight),
      clientHeight: round(clientHeight),
      flexDirection: flexDirection,
      isColumnReverse: reverse,
      maxLogicalPosition: round(max),
      logicalPosition: round(logical),
      logicalRatio: max > 0 ? round(logical / max, 6) : 0
    };
  }

  function getIndexTurns(a) {
    if (!a || !a.currentConversationId) return [];
    return safe(() => a.getTurnIndex(a.currentConversationId).getOrdered(), []) || [];
  }

  function getVisibleTurns(a) {
    return safe(() => a.host.getVisibleTurns(), []) || [];
  }

  function collectMarkers() {
    return Array.from(D.querySelectorAll(MARKER)).map((el, index) => {
      const rawId = rawMarkerId(el);
      return {
      index: index,
      id: canonicalMarkerId(rawId),
      rawId: rawId,
      tag: String(el.tagName || "").toLowerCase(),
      role: el.getAttribute && el.getAttribute("role"),
      ariaLabel: el.getAttribute && el.getAttribute("aria-label"),
      ariaCurrent: el.getAttribute && el.getAttribute("aria-current"),
      title: el.getAttribute && el.getAttribute("title"),
      className: typeof el.className === "string" ? el.className : null,
      disabled: Boolean(el.disabled),
      rect: rect(el),
      outerHTML: String(el.outerHTML || "").slice(0, 1600)
    };
    });
  }

  function countMap(values) {
    const m = new Map();
    for (const v of values) m.set(v, (m.get(v) || 0) + 1);
    return m;
  }

  function ratio(a, b) {
    return Number(b) > 0 ? round(Number(a) / Number(b), 6) : 0;
  }

  function analyzeMapping(markers, turns) {
    const list = (turns || [])
      .filter(t => t && t.id && Number.isFinite(Number(t.order)))
      .map(t => ({
        id: String(t.id),
        order: Number(t.order),
        text: String(t.text || "").slice(0, 300),
        source: t.source || null
      }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    const orderById = new Map(list.map(t => [t.id, t.order]));
    const markerIds = markers.map(m => m.id).filter(Boolean);
    const rawMarkerIds = markers.map(m => m.rawId).filter(Boolean);
    const markerCounts = countMap(markerIds);
    const rawMarkerCounts = countMap(rawMarkerIds);
    const turnCounts = countMap(list.map(t => t.id));
    const duplicateMarkerIds = Array.from(markerCounts.entries()).filter(x => x[1] > 1).map(x => x[0]);
    const duplicateRawMarkerIds = Array.from(rawMarkerCounts.entries()).filter(x => x[1] > 1).map(x => x[0]);
    const duplicateTurnIds = Array.from(turnCounts.entries()).filter(x => x[1] > 1).map(x => x[0]);
    const exact = [];
    const matchedOrders = [];
    const matchedTurnIds = new Set();

    for (const m of markers) {
      const order = orderById.get(m.id);
      if (Number.isFinite(order)) {
        exact.push({ id: m.id, rawId: m.rawId, markerIndex: m.index, order: order });
        matchedOrders.push(order);
        matchedTurnIds.add(m.id);
      }
    }

    const canonicalGroups = Array.from(markerCounts.entries())
      .map(([id, count]) => ({
        id,
        count,
        knownTurn: orderById.has(id),
        order: orderById.has(id) ? orderById.get(id) : null,
        rawIds: markers.filter(m => m.id === id).map(m => m.rawId),
        markerIndexes: markers.filter(m => m.id === id).map(m => m.index)
      }))
      .sort((a, b) => {
        const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
        return ao - bo || a.id.localeCompare(b.id);
      });

    const missingTurns = list
      .filter(t => !markerCounts.has(t.id))
      .map(t => ({ id: t.id, order: t.order, text: t.text }));
    const extraMarkers = markers
      .filter(m => m.id && !orderById.has(m.id))
      .map(m => ({
        id: m.id,
        rawId: m.rawId,
        markerIndex: m.index,
        ariaLabel: m.ariaLabel,
        rect: m.rect
      }));

    let orderedExact = 0;
    const n = Math.min(markers.length, list.length);
    for (let i = 0; i < n; i += 1) {
      if (markers[i].id && markers[i].id === list[i].id) orderedExact += 1;
    }

    const monotonic = matchedOrders.every((order, i) => i === 0 || order > matchedOrders[i - 1]);
    const bridgeEligible = list.length > 0
      && duplicateMarkerIds.length === 0
      && duplicateTurnIds.length === 0
      && missingTurns.length === 0
      && matchedTurnIds.size === list.length
      && monotonic;

    return {
      markerIdFormat: "leading UUID canonicalized from official <uuid>:<part>:user or <uuid>:<uuid> forms",
      markerCount: markers.length,
      uniqueRawMarkerIdCount: new Set(rawMarkerIds).size,
      uniqueMarkerIdCount: new Set(markerIds).size,
      markerWithoutIdCount: markers.filter(m => !m.id).length,
      duplicateRawMarkerIds: duplicateRawMarkerIds,
      duplicateMarkerIds: duplicateMarkerIds,
      canonicalGroups: canonicalGroups,
      knownTurnCount: list.length,
      uniqueTurnIdCount: new Set(list.map(t => t.id)).size,
      duplicateTurnIds: duplicateTurnIds,
      exactIdMatches: exact.length,
      exactMarkerMatches: exact.length,
      uniqueExactTurnMatches: matchedTurnIds.size,
      exactButtonCoverage: ratio(exact.length, markers.length),
      exactTurnCoverage: ratio(matchedTurnIds.size, list.length),
      missingTurnCount: missingTurns.length,
      missingTurns: missingTurns,
      extraMarkerCount: extraMarkers.length,
      extraMarkers: extraMarkers,
      orderedExactMatches: orderedExact,
      orderedCoverage: ratio(orderedExact, n),
      matchedOrderMonotonic: monotonic,
      bridgeEligible: bridgeEligible,
      oneToOneExact: markers.length > 0
        && markers.length === list.length
        && extraMarkers.length === 0
        && missingTurns.length === 0
        && duplicateMarkerIds.length === 0
        && duplicateTurnIds.length === 0
        && exact.length === markers.length
        && orderedExact === markers.length
        && monotonic,
      exactMarkers: exact,
      markerSample: markers.slice(0, 20),
      turnSample: list.slice(0, 20)
    };
  }

  function capability(label) {
    const a = app();
    const status = safe(() => a.status(), null);
    const identity = safe(() => a.host.getConversationIdentity(), null);
    const hostMode = safe(() => a.host.getHostMode(), null);
    const container = safe(() => a.host.getScrollContainer(), null);
    const turns = getIndexTurns(a);
    const visible = getVisibleTurns(a);
    const markers = collectMarkers();
    return {
      label: label || "capture",
      at: new Date().toISOString(),
      scriptVersion: VERSION,
      href: W.location.href,
      userAgent: navigator.userAgent,
      viewport: {
        width: W.innerWidth,
        height: W.innerHeight,
        devicePixelRatio: W.devicePixelRatio
      },
      app: {
        present: Boolean(a),
        version: status && status.version,
        health: status && status.health
      },
      conversationId: a && a.currentConversationId,
      identity: clone(identity),
      hostMode: hostMode,
      surface: status && status.surface,
      timeline: {
        knownTurns: turns.length,
        visibleTurns: visible.length,
        activeTurnId: status && status.timeline && status.timeline.activeTurnId,
        orderHealth: clone(status && status.timeline && status.timeline.orderHealth),
        cacheHydration: clone(status && status.timeline && status.timeline.cacheHydration)
      },
      scrollOwnership: clone(status && status.scrollOwnership),
      scroll: scrollState(container),
      mapping: analyzeMapping(markers, turns),
      visibleTurnSample: visible.slice(0, 20).map(t => ({
        id: String(t.id || ""),
        order: Number.isFinite(Number(t.order)) ? Number(t.order) : null,
        text: String(t.text || "").slice(0, 300),
        source: t.source || null
      })),
      rawStatus: clone(status)
    };
  }

  function gate(expectedId, options = {}) {
    const c = capability("gate");
    const id = c.identity && c.identity.id || c.conversationId;
    if (!c.app.present) return { ok: false, reason: "missing-app", capability: c };
    if (c.hostMode !== "work") return { ok: false, reason: "not-work", capability: c };
    if (!c.identity || !c.identity.stable) return { ok: false, reason: "identity-unstable", capability: c };
    if (expectedId && String(id) !== String(expectedId)) return { ok: false, reason: "conversation-changed", capability: c };
    if (!c.timeline.orderHealth || c.timeline.orderHealth.healthy !== true) return { ok: false, reason: "timeline-unhealthy", capability: c };
    if (c.timeline.cacheHydration && c.timeline.cacheHydration.status === "rejected") return { ok: false, reason: "cache-rejected", capability: c };
    if (c.scrollOwnership && c.scrollOwnership.conflict) return { ok: false, reason: "scroll-owner-conflict", capability: c };
    if (!c.scrollOwnership || c.scrollOwnership.owner !== "idle") return { ok: false, reason: "scroll-owner-not-idle", capability: c };
    if (!c.scroll.present) return { ok: false, reason: "missing-scroll-container", capability: c };
    if (c.mapping.markerCount <= 0) return { ok: false, reason: "no-official-markers", capability: c };

    if (options.requireExactTargets) {
      if (!c.mapping.uniqueExactTurnMatches) return { ok: false, reason: "no-canonical-id-matches", capability: c };
      return { ok: true, reason: c.mapping.bridgeEligible ? "bridge-eligible" : "per-target-eligibility-required", capability: c };
    }

    return { ok: true, reason: "observation-eligible", capability: c };
  }

  function targetState(targetId) {
    const a = app();
    const container = safe(() => a.host.getScrollContainer(), null);
    const turns = getIndexTurns(a);
    const turn = turns.find(t => String(t.id) === String(targetId));
    const el = safe(() => a.host.resolveTurn(targetId), null);
    const r = rect(el);
    const cr = rect(container);
    const visibleTurns = getVisibleTurns(a);
    const byAdapter = visibleTurns.some(t => String(t.id) === String(targetId));
    const byRect = Boolean(r && cr && r.bottom >= cr.top && r.top <= cr.bottom);
    return {
      id: String(targetId),
      order: turn && Number.isFinite(Number(turn.order)) ? Number(turn.order) : null,
      mounted: Boolean(el && el.isConnected !== false),
      visible: Boolean(byAdapter || byRect),
      visibleByAdapter: byAdapter,
      visibleByRect: byRect,
      rect: r
    };
  }

  function snapshot(targetId) {
    const a = app();
    const status = safe(() => a.status(), null);
    const container = safe(() => a.host.getScrollContainer(), null);
    const visible = getVisibleTurns(a).map(t => ({
      id: String(t.id || ""),
      order: Number.isFinite(Number(t.order)) ? Number(t.order) : null,
      text: String(t.text || "").slice(0, 300)
    }));
    return {
      at: new Date().toISOString(),
      conversationId: a && a.currentConversationId,
      identity: clone(safe(() => a.host.getConversationIdentity(), null)),
      activeTurnId: safe(() => a.host.getActiveTurnId(), null),
      visible: {
        turns: visible,
        signature: visible.map(t => t.id + ":" + (t.order == null ? "?" : t.order)).join("|")
      },
      scroll: scrollState(container),
      target: targetState(targetId),
      timeline: {
        orderHealth: clone(status && status.timeline && status.timeline.orderHealth),
        cacheHydration: clone(status && status.timeline && status.timeline.cacheHydration)
      },
      scrollOwnership: clone(status && status.scrollOwnership)
    };
  }

  function eventInfo(ev) {
    const m = markerFromEvent(ev);
    return {
      type: ev.type,
      trusted: Boolean(ev.isTrusted),
      timeStamp: round(ev.timeStamp),
      markerId: markerId(m) || null,
      markerRawId: rawMarkerId(m) || null,
      button: Number.isFinite(Number(ev.button)) ? Number(ev.button) : null,
      buttons: Number.isFinite(Number(ev.buttons)) ? Number(ev.buttons) : null,
      pointerType: ev.pointerType || null,
      defaultPrevented: Boolean(ev.defaultPrevented),
      targetTag: String(ev.target && ev.target.tagName || "").toLowerCase() || null
    };
  }

  function markerCensus(label = "census") {
    const a = app();
    const turns = getIndexTurns(a);
    const markers = collectMarkers();
    const mapping = analyzeMapping(markers, turns);
    return {
      label,
      at: new Date().toISOString(),
      markerCount: mapping.markerCount,
      uniqueRawMarkerIdCount: mapping.uniqueRawMarkerIdCount,
      uniqueMarkerIdCount: mapping.uniqueMarkerIdCount,
      knownTurnCount: mapping.knownTurnCount,
      exactMarkerMatches: mapping.exactMarkerMatches,
      uniqueExactTurnMatches: mapping.uniqueExactTurnMatches,
      exactTurnCoverage: mapping.exactTurnCoverage,
      extraMarkerCount: mapping.extraMarkerCount,
      missingTurnCount: mapping.missingTurnCount,
      duplicateMarkerIds: mapping.duplicateMarkerIds.slice(),
      ambiguousKnownTurns: mapping.canonicalGroups
        .filter(group => group.knownTurn && group.count > 1)
        .map(group => ({
          id: group.id,
          order: group.order,
          count: group.count,
          rawIds: group.rawIds.slice(),
          markerIndexes: group.markerIndexes.slice()
        }))
    };
  }

  function programmaticEligibility() {
    const a = app();
    const turns = getIndexTurns(a)
      .filter(t => t && t.id && Number.isFinite(Number(t.order)))
      .map(t => ({ id: String(t.id), order: Number(t.order) }))
      .sort((a, b) => a.order - b.order);
    const markers = collectMarkers();
    const groups = new Map();
    for (const marker of markers) {
      if (!groups.has(marker.id)) groups.set(marker.id, []);
      groups.get(marker.id).push(marker);
    }

    const eligible = [];
    const ambiguous = [];
    const missing = [];
    for (const turn of turns) {
      const group = groups.get(turn.id) || [];
      if (group.length === 1) {
        eligible.push({
          id: turn.id,
          order: turn.order,
          rawId: group[0].rawId,
          markerIndex: group[0].index
        });
      } else if (group.length > 1) {
        ambiguous.push({
          id: turn.id,
          order: turn.order,
          count: group.length,
          rawIds: group.map(m => m.rawId),
          markerIndexes: group.map(m => m.index)
        });
      } else {
        missing.push({ id: turn.id, order: turn.order });
      }
    }

    return {
      at: new Date().toISOString(),
      markerCount: markers.length,
      knownTurnCount: turns.length,
      eligible,
      ambiguous,
      missing
    };
  }

  function uniqueMarker(id) {
    const canonical = String(id);
    const nodes = Array.from(D.querySelectorAll(MARKER)).filter(el => markerId(el) === canonical);
    return nodes.length === 1 ? nodes[0] : null;
  }

  function trigger(el, mode) {
    const r = rect(el) || { left: 0, top: 0, width: 0, height: 0 };
    const x = Number(r.left) + Number(r.width) / 2;
    const y = Number(r.top) + Number(r.height) / 2;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: W,
      clientX: x,
      clientY: y,
      button: 0
    };
    if (mode === "element-click") {
      el.click();
      return;
    }
    if (mode === "mouse-sequence") {
      el.dispatchEvent(new MouseEvent("mousedown", Object.assign({}, base, { buttons: 1 })));
      el.dispatchEvent(new MouseEvent("mouseup", Object.assign({}, base, { buttons: 0 })));
      el.dispatchEvent(new MouseEvent("click", Object.assign({}, base, { buttons: 0 })));
      return;
    }
    if (mode === "pointer-sequence") {
      const P = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new P("pointerdown", Object.assign({}, base, { buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true })));
      el.dispatchEvent(new P("pointerup", Object.assign({}, base, { buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })));
      el.dispatchEvent(new MouseEvent("click", Object.assign({}, base, { buttons: 0 })));
      return;
    }
    throw new Error("Unknown mode " + mode);
  }

  async function observeAction(run, spec) {
    const a = app();
    const container = safe(() => a.host.getScrollContainer(), null);
    const initialContainer = container;
    const before = snapshot(spec.targetId);
    const started = now();
    let scrollEvents = 0;
    let mutationCount = 0;
    let firstScroll = null;
    let firstMutation = null;
    let firstWindow = null;
    let firstExtent = null;
    let firstMounted = before.target.mounted ? 0 : null;
    let firstVerified = before.target.visible ? 0 : null;
    let triggerError = null;
    const eventTrace = [];
    const windowSig = before.visible.signature;
    const startHeight = Number(before.scroll.scrollHeight || 0);
    const startMax = Number(before.scroll.maxLogicalPosition || 0);

    const onScroll = () => {
      scrollEvents += 1;
      if (firstScroll == null) firstScroll = now() - started;
    };
    const onEvent = ev => {
      const m = markerFromEvent(ev);
      if (m && markerId(m) === String(spec.targetId)) {
        eventTrace.push(eventInfo(ev));
        if (eventTrace.length > 30) eventTrace.shift();
      }
    };
    if (container) container.addEventListener("scroll", onScroll, { passive: true });
    ["pointerdown", "mousedown", "mouseup", "pointerup", "click"].forEach(type => D.addEventListener(type, onEvent, true));

    let observer = null;
    if (container && typeof MutationObserver === "function") {
      observer = new MutationObserver(list => {
        mutationCount += list.length;
        if (firstMutation == null) firstMutation = now() - started;
      });
      try { observer.observe(container, { childList: true, subtree: true, attributes: true }); } catch {}
    }

    if (typeof spec.action === "function") {
      try { spec.action(); } catch (e) { triggerError = { name: e.name, message: e.message, stack: String(e.stack || "") }; }
    }

    let after = before;
    let verifiedSince = null;
    while (now() - started < run.config.timeoutMs) {
      if (run.aborted) break;
      await sleep(run.config.pollMs);
      after = snapshot(spec.targetId);
      if (firstWindow == null && after.visible.signature !== windowSig) firstWindow = now() - started;
      if (firstExtent == null && (Math.abs(Number(after.scroll.scrollHeight || 0) - startHeight) > 1 || Math.abs(Number(after.scroll.maxLogicalPosition || 0) - startMax) > 1)) {
        firstExtent = now() - started;
      }
      if (firstMounted == null && after.target.mounted) firstMounted = now() - started;
      if (firstVerified == null && after.target.visible) firstVerified = now() - started;
      if (after.target.visible) {
        if (verifiedSince == null) verifiedSince = now();
        if (now() - verifiedSince >= run.config.settleMs) break;
      } else {
        verifiedSince = null;
      }
    }

    if (container) container.removeEventListener("scroll", onScroll);
    ["pointerdown", "mousedown", "mouseup", "pointerup", "click"].forEach(type => D.removeEventListener(type, onEvent, true));
    if (observer) observer.disconnect();

    const changedWindow = after.visible.signature !== windowSig;
    const changedExtent = Math.abs(Number(after.scroll.scrollHeight || 0) - startHeight) > 1 || Math.abs(Number(after.scroll.maxLogicalPosition || 0) - startMax) > 1;
    const containerChanged = initialContainer !== safe(() => a.host.getScrollContainer(), null);
    let result = "no-effect";
    if (after.target.visible) result = "verified-target";
    else if (after.target.mounted) result = "mounted-not-visible";
    else if (changedWindow || changedExtent || scrollEvents > 0) result = "navigation-change-no-target";
    if (triggerError) result = "trigger-error";

    return {
      kind: spec.kind,
      trusted: Boolean(spec.trusted),
      targetId: spec.targetId,
      targetOrder: before.target.order,
      startedAt: new Date(Date.now() - (now() - started)).toISOString(),
      finishedAt: new Date().toISOString(),
      result: result,
      verified: Boolean(after.target.visible),
      triggerEvent: spec.triggerEvent || null,
      triggerError: triggerError,
      eventTrace: eventTrace,
      timings: {
        totalMs: round(now() - started),
        firstScrollMs: round(firstScroll),
        firstMutationMs: round(firstMutation),
        firstWindowMs: round(firstWindow),
        firstExtentMs: round(firstExtent),
        firstMountedMs: round(firstMounted),
        verifiedMs: round(firstVerified)
      },
      counts: {
        scrollEvents: scrollEvents,
        mutations: mutationCount
      },
      changes: {
        windowChanged: changedWindow,
        extentChanged: changedExtent,
        containerChanged: containerChanged
      },
      before: before,
      after: after
    };
  }

  function distributed(list, n) {
    if (!list.length) return [];
    const count = Math.min(list.length, Math.max(1, n));
    if (count === list.length) return list.slice();
    const out = [];
    const used = new Set();
    for (let i = 0; i < count; i += 1) {
      let index = Math.round(((i + 1) / (count + 1)) * (list.length - 1));
      while (used.has(index) && index + 1 < list.length) index += 1;
      if (!used.has(index)) {
        used.add(index);
        out.push(list[index]);
      }
    }
    return out;
  }

  function summarize(actions) {
    const list = actions.filter(x => !x.skipped);
    const ok = list.filter(x => x.verified);
    const latencyOk = ok.filter(x => !(x.before?.target?.visible === true));
    const times = latencyOk
      .map(x => Number(x.timings && x.timings.verifiedMs))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const percentile = q => {
      if (!times.length) return null;
      const i = Math.min(times.length - 1, Math.max(0, Math.ceil(q * times.length) - 1));
      return round(times[i]);
    };
    const results = {};
    list.forEach(x => { results[x.result] = (results[x.result] || 0) + 1; });
    return {
      total: list.length,
      verified: ok.length,
      verifiedRate: ratio(ok.length, list.length),
      preVisibleCount: ok.length - latencyOk.length,
      latencySampleCount: latencyOk.length,
      medianVerifiedMs: percentile(0.5),
      p95VerifiedMs: percentile(0.95),
      results: results
    };
  }

  function reportSummary(run) {
    const modes = {};
    ["element-click", "mouse-sequence", "pointer-sequence"].forEach(mode => {
      modes[mode] = summarize(run.programmatic.filter(x => x.kind === mode));
    });
    const direct = modes["element-click"];
    let verdict = "insufficient-data";
    if (direct.total >= run.config.samplesPerMode && direct.verified === direct.total) verdict = "element-click-promising";
    else if (direct.total > 0 && direct.verified === 0) verdict = "element-click-failed";
    else if (direct.total > 0) verdict = "mixed";
    return {
      manual: summarize(run.manual),
      manualUnmapped: summarize(run.manualUnmapped || []),
      programmatic: summarize(run.programmatic),
      byMode: modes,
      programmaticModeDecisions: clone(run.programmaticModeDecisions || []),
      directBridgeVerdict: verdict,
      mapping: run.finalCapability && run.finalCapability.mapping
    };
  }

  async function captureManual(run) {
    const needed = run.config.manualClicks;
    const unique = new Set();
    let busy = false;

    console.info("[GTE v0.5.4] MANUAL PHASE: click " + needed + " DIFFERENT mapped official rail markers. Unmapped official markers are recorded but do not count.");
    showGuide(
      "v0.5.4 人工官方导航测试 · 0/" + needed,
      "请点击官方 Work 导航轨道中的不同节点。\n每次点击后等待本提示更新，再点下一个。"
    );

    return new Promise(resolve => {
      const onClick = ev => {
        if (run.aborted || busy || !ev.isTrusted) return;
        const marker = markerFromEvent(ev);
        const id = markerId(marker);
        if (!marker || !id || unique.has(id)) return;

        const currentMapping = capability("manual-click-gate").mapping;
        const mapped = (currentMapping.exactMarkers || []).some(item => item.id === id);
        if (!mapped) {
          busy = true;
          showGuide(
            "检测到额外官方节点",
            "这个 marker 不在 GTE 已知 TurnIndex 中。正在记录，但不会计入 " + needed + " 次有效样本。",
            "warn"
          );
          observeAction(run, {
            kind: "manual-trusted-unmapped-marker",
            trusted: true,
            targetId: id,
            triggerEvent: eventInfo(ev),
            action: null
          }).then(record => {
            run.manualUnmapped.push(record);
            persist(run);
            console.warn("[GTE v0.5.4] unmapped official marker recorded; not counted toward required samples", {
              canonicalId: id,
              rawId: rawMarkerId(marker),
              result: record.result,
              record: record
            });
            busy = false;
            showGuide(
              "v0.5.4 人工官方导航测试 · " + unique.size + "/" + needed,
              "额外 marker 已记录，不计数。请继续点击另一个已映射的官方导航节点。",
              "warn"
            );
          }).catch(err => {
            busy = false;
            showGuide("额外 marker 记录失败", String(err?.message || err), "error");
            console.error("[GTE v0.5.4] unmapped manual observation failed", err);
          });
          return;
        }

        busy = true;
        showGuide(
          "正在记录第 " + (unique.size + 1) + "/" + needed + " 次",
          "请暂时不要继续点击，等待本次官方导航稳定。"
        );
        observeAction(run, {
          kind: "manual-trusted-click",
          trusted: true,
          targetId: id,
          triggerEvent: eventInfo(ev),
          action: null
        }).then(record => {
          run.manual.push(record);
          if (record.verified) unique.add(id);
          persist(run);
          console.info("[GTE v0.5.4] manual " + unique.size + "/" + needed, record.result, record);
          busy = false;
          if (unique.size >= needed) {
            showGuide(
              "人工阶段完成 · " + needed + "/" + needed,
              "即将进入自动 programmatic 测试。接下来请不要操作页面。",
              "success"
            );
            D.removeEventListener("click", onClick, true);
            resolve();
          } else if (record.verified) {
            showGuide(
              "v0.5.4 人工官方导航测试 · " + unique.size + "/" + needed,
              "已记录成功。请点击另一个不同的官方导航节点。",
              "success"
            );
          } else {
            showGuide(
              "本次未验证成功 · 仍为 " + unique.size + "/" + needed,
              "这次不计数。请换一个不同的官方导航节点再试。",
              "warn"
            );
          }
        }).catch(err => {
          busy = false;
          showGuide("人工样本记录失败", String(err?.message || err), "error");
          console.error("[GTE v0.5.4] manual observation failed", err);
        });
      };
      D.addEventListener("click", onClick, true);
      run.cleanup = () => D.removeEventListener("click", onClick, true);
    });
  }

  async function waitIdle(expectedId, ms) {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) {
      const g = gate(expectedId);
      if (g.ok) {
        await sleep(120);
        return true;
      }
      if (g.reason === "conversation-changed") return false;
      await sleep(50);
    }
    return false;
  }

  async function runProgrammatic(run) {
    const modes = ["element-click", "mouse-sequence", "pointer-sequence"];
    run.programmaticModeDecisions = run.programmaticModeDecisions || [];

    for (const mode of modes) {
      if (run.aborted) return;

      if (mode !== "element-click") {
        const directSummary = summarize(run.programmatic.filter(x => x.kind === "element-click"));
        const directPassed = directSummary.total >= run.config.samplesPerMode
          && directSummary.verified === directSummary.total;
        if (!directPassed) {
          const decision = {
            mode,
            decision: "skip",
            reason: "element-click-threshold-not-met",
            requiredSamples: run.config.samplesPerMode,
            elementClickSummary: directSummary,
            at: new Date().toISOString()
          };
          run.programmaticModeDecisions.push(decision);
          persist(run);
          console.warn("[GTE v0.5.4] skipping heavier mode", decision);
          continue;
        }
      }

      const eligibilityAtModeStart = programmaticEligibility();
      const targets = distributed(eligibilityAtModeStart.eligible, run.config.samplesPerMode);
      run.programmaticModeDecisions.push({
        mode,
        decision: targets.length ? "run" : "skip",
        reason: targets.length ? "unique-targets-available" : "no-unique-targets",
        requestedSamples: run.config.samplesPerMode,
        selectedSamples: targets.length,
        eligibleCount: eligibilityAtModeStart.eligible.length,
        ambiguousCount: eligibilityAtModeStart.ambiguous.length,
        missingCount: eligibilityAtModeStart.missing.length,
        at: new Date().toISOString()
      });
      persist(run);

      showGuide(
        "自动测试 · " + mode,
        "请勿操作页面。唯一可用目标 " + eligibilityAtModeStart.eligible.length
          + " 个，本轮计划测试 " + targets.length + " 个。"
      );

      if (!targets.length) {
        run.programmatic.push({
          kind: mode,
          skipped: true,
          reason: "no-unique-exact-markers",
          eligibility: clone(eligibilityAtModeStart)
        });
        persist(run);
        continue;
      }

      for (let sampleIndex = 0; sampleIndex < targets.length; sampleIndex += 1) {
        const t = targets[sampleIndex];
        if (run.aborted) return;

        showGuide(
          "自动测试 · " + mode + " · " + (sampleIndex + 1) + "/" + targets.length,
          "目标 Q" + (t.order + 1) + "。请勿点击或滚动页面。"
        );

        await waitIdle(run.conversationId, 5000);
        const g = gate(run.conversationId);
        const beforeCensus = markerCensus("before-" + mode + "-Q" + (t.order + 1));

        if (!g.ok) {
          run.programmatic.push({
            kind: mode,
            targetId: t.id,
            targetOrder: t.order,
            skipped: true,
            reason: g.reason,
            markerCensus: { before: beforeCensus, after: null },
            capability: g.capability
          });
          persist(run);
          continue;
        }

        const freshEligibility = programmaticEligibility();
        const freshTarget = freshEligibility.eligible.find(item => item.id === t.id);
        if (!freshTarget) {
          const ambiguous = freshEligibility.ambiguous.find(item => item.id === t.id);
          run.programmatic.push({
            kind: mode,
            targetId: t.id,
            targetOrder: t.order,
            skipped: true,
            reason: ambiguous ? "target-became-ambiguous" : "target-not-uniquely-mapped",
            eligibility: {
              ambiguous: clone(ambiguous || null),
              missing: freshEligibility.missing.some(item => item.id === t.id)
            },
            markerCensus: {
              before: beforeCensus,
              after: markerCensus("after-skip-" + mode + "-Q" + (t.order + 1))
            }
          });
          persist(run);
          continue;
        }

        console.info("[GTE v0.5.4] programmatic", mode, "Q" + (t.order + 1), t.id);

        const record = await observeAction(run, {
          kind: mode,
          trusted: false,
          targetId: t.id,
          action: () => {
            const live = uniqueMarker(t.id);
            if (!live) throw new Error("target-marker-not-unique-at-trigger");
            trigger(live, mode);
          }
        });

        record.markerCensus = {
          before: beforeCensus,
          after: markerCensus("after-" + mode + "-Q" + (t.order + 1))
        };
        record.targetEligibility = {
          selectedRawId: freshTarget.rawId,
          selectedMarkerIndex: freshTarget.markerIndex
        };

        run.programmatic.push(record);
        persist(run);
        console.info("[GTE v0.5.4] result", record.result, record);
        await sleep(run.config.settleMs);
      }

      if (mode === "element-click") {
        const directSummary = summarize(run.programmatic.filter(x => x.kind === "element-click"));
        const directPassed = directSummary.total >= run.config.samplesPerMode
          && directSummary.verified === directSummary.total;
        run.programmaticModeDecisions.push({
          mode,
          decision: directPassed ? "pass-threshold" : "fail-threshold",
          requiredSamples: run.config.samplesPerMode,
          summary: directSummary,
          at: new Date().toISOString()
        });
        persist(run);

        if (!directPassed) {
          showGuide(
            "HTMLElement.click() 未达到继续阈值",
            "已执行 " + directSummary.total + " 次，验证成功 "
              + directSummary.verified + " 次。MouseEvent / PointerEvent 将跳过。",
            "warn"
          );
        }
      }
    }
  }

  function persist(run) {
    if (run?.config?.persist) {
      try { localStorage.setItem(STORE, JSON.stringify(run, reportJsonReplacer)); } catch {}
    }
    scheduleFileCheckpoint(run);
  }

  async function exportReport(run, status = "manual") {
    if (!run) return { written: false, reason: "no-report" };
    run.manualExportStatus = status;
    return await flushFileCheckpoint(run);
  }

  async function autoSaveReport(run, status) {
    if (!run) return null;
    run.autoSaveStatus = status;
    persist(run);
    const result = await flushFileCheckpoint(run);

    const statusLabel = status === "success"
      ? "测试成功"
      : status === "error"
        ? "测试已停止"
        : status === "aborted"
          ? "测试已中止"
          : String(status || "unknown");

    guideDismissed = false;

    if (result?.written === true) {
      showGuide(
        "报告已保存到本地",
        "结果：" + statusLabel
          + "\n文件：" + String(result.fileName || run.reportFileName || "(未知)")
          + "\n最终写入时间：" + String(result.at || new Date().toISOString()),
        "success"
      );
      hideGuide(12000);
      console.info("[GTE v0.5.4] final report saved", result);
    } else {
      const reason = String(
        result?.error
          || result?.reason
          || run.fileCheckpoint?.error
          || "unknown write failure"
      );
      showGuide(
        "报告写入失败",
        "结果：" + statusLabel
          + "\n文件：" + String(run.reportFileName || "(未知)")
          + "\n错误：" + reason,
        "error"
      );
      console.error("[GTE v0.5.4] final report save failed", result);
    }

    return result;
  }

  async function runAll(options) {
    if (current && current.running) return current;
    guideDismissed = false;
    const config = Object.assign({}, DEFAULTS, options || {});
    let reportFileHandle;
    try {
      reportFileHandle = await requestReportFile();
    } catch (storageError) {
      const failed = {
        schemaVersion: 1,
        scriptVersion: VERSION,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        running: false,
        aborted: true,
        abortReason: "report-file-unavailable",
        error: { name: storageError?.name || "Error", message: String(storageError?.message || storageError) }
      };
      current = failed;
      try { localStorage.setItem(STORE, JSON.stringify(failed)); } catch {}
      return failed;
    }
    const pre = capability("preflight");
    const id = pre.identity && pre.identity.id || pre.conversationId;
    const run = current = {
      schemaVersion: 1,
      scriptVersion: VERSION,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      running: true,
      aborted: false,
      config: config,
      reportFileHandle: reportFileHandle,
      reportFileName: reportFileHandle?.name || null,
      conversationId: id,
      environment: {
        href: location.href,
        userAgent: navigator.userAgent,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }
      },
      preflight: pre,
      manual: [],
      manualUnmapped: [],
      programmatic: [],
      programmaticModeDecisions: [],
      extraCapabilities: [],
      finalCapability: null,
      summary: null,
      error: null,
      cleanup: null
    };

    persist(run);
    showGuide("v0.5.4 研究脚本", "正在执行 preflight，请稍候。");
    console.group("[GTE v0.5.4] Official Marker Research");
    console.info("Preflight", pre);

    try {
      const g = gate(id);
      if (!g.ok) throw new Error("Preflight gate failed: " + g.reason);

      await captureManual(run);
      if (run.aborted) throw new Error("Aborted");

      const manualSummary = summarize(run.manual);
      if (manualSummary.verified !== config.manualClicks) {
        throw new Error("Manual official navigation did not verify all samples: " + manualSummary.verified + "/" + config.manualClicks);
      }

      const afterManualGate = gate(id);
      if (!afterManualGate.ok) throw new Error("Programmatic base gate failed: " + afterManualGate.reason);

      await runProgrammatic(run);
      run.finalCapability = capability("final");
      run.summary = reportSummary(run);
      run.finishedAt = new Date().toISOString();
      run.running = false;
      persist(run);

      console.info("SUMMARY", run.summary);
      console.info("FULL REPORT", run);
      console.groupEnd();
      showGuide(
        "v0.5.4 测试完成",
        "报告已生成。Direct Bridge 判定：" + String(run.summary?.directBridgeVerdict || "unknown"),
        "success"
      );
      await autoSaveReport(run, "success");
      return run;
    } catch (e) {
      run.error = { name: e.name || "Error", message: String(e.message || e), stack: String(e.stack || "") };
      run.finalCapability = capability("error-final");
      run.summary = reportSummary(run);
      run.finishedAt = new Date().toISOString();
      run.running = false;
      persist(run);
      console.error("[GTE v0.5.4] stopped", e, run);
      console.groupEnd();
      showGuide(
        "v0.5.4 测试已停止",
        String(e?.message || e) + "\n报告正在写入已选择的 JSON 文件。",
        "error"
      );
      await autoSaveReport(run, "error");
      return run;
    } finally {
      if (run.cleanup) {
        try { run.cleanup(); } catch {}
        run.cleanup = null;
      }
    }
  }

  function abort(reason) {
    if (!current) return false;
    current.aborted = true;
    current.abortReason = reason || "user-abort";
    if (!current.finishedAt) current.finishedAt = new Date().toISOString();
    if (current.cleanup) {
      try { current.cleanup(); } catch {}
      current.cleanup = null;
    }
    persist(current);
    showGuide("v0.5.4 测试已中止", current.abortReason + "\n当前报告正在写入已选择的 JSON 文件。", "warn");
    void autoSaveReport(current, "aborted");
    return true;
  }

  function loadLatest() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  const old = W[API];
  try { if (old && typeof old.destroy === "function") old.destroy(); } catch {}

  W[API] = {
    version: VERSION,
    runAll: runAll,
    abort: abort,
    capability: capability,
    captureCapability: label => {
      const c = capability(label || "extra");
      if (current) {
        if (!Array.isArray(current.extraCapabilities)) current.extraCapabilities = [];
        current.extraCapabilities.push(c);
        persist(current);
      }
      return c;
    },
    getReport: () => current || loadLatest(),
    getReportJson: () => JSON.stringify(current || loadLatest(), null, 2),
    exportReport: () => current ? exportReport(current, "manual") : Promise.resolve({ written: false, reason: "no-current-report" }),
    chooseReportFile: chooseReportFile,
    closeGuide: () => {
      guideDismissed = true;
      hideGuide();
      return true;
    },
    destroy: () => {
      abort("destroy");
      hideGuide();
      delete W[API];
      return true;
    }
  };

  console.info("[GTE v0.5.4 research] loaded. Start with: await __GTEV054Research.runAll()");
})();
