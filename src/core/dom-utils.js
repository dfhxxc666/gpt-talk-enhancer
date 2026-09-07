export function isElement(value) {
  return Boolean(value && value.nodeType === 1);
}

export function toNodeArray(value) {
  if (value === null || value === undefined) {
    return [];
  }
  try {
    return Array.from(value);
  } catch {
    return [];
  }
}

export function asElement(value) {
  if (isElement(value)) {
    return value;
  }
  return value?.parentElement && isElement(value.parentElement) ? value.parentElement : null;
}

export function queryFirst(root, selectors) {
  if (!root || !Array.isArray(selectors)) {
    return null;
  }

  for (const selector of selectors) {
    try {
      if (isElement(root) && root.matches(selector)) {
        return root;
      }
      const match = root.querySelector(selector);
      if (match) {
        return match;
      }
    } catch {
      // A selector contract error must not stop the rest of the adapter refresh.
    }
  }

  return null;
}

export function queryAll(root, selectors) {
  if (!root || !Array.isArray(selectors)) {
    return [];
  }

  const result = [];
  const seen = new Set();
  for (const selector of selectors) {
    try {
      if (isElement(root) && root.matches(selector) && !seen.has(root)) {
        result.push(root);
        seen.add(root);
      }
      for (const element of root.querySelectorAll(selector)) {
        if (!seen.has(element)) {
          result.push(element);
          seen.add(element);
        }
      }
    } catch {
      // Ignore a broken fallback selector while preserving other contract selectors.
    }
  }
  return result;
}

export function matchesAny(element, selectors) {
  if (!isElement(element)) {
    return false;
  }
  return selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

export function containsAny(element, selectors) {
  if (!element) {
    return false;
  }
  if (matchesAny(element, selectors)) {
    return true;
  }
  try {
    return selectors.some((selector) => Boolean(element.querySelector(selector)));
  } catch {
    return false;
  }
}

export function closestAny(element, selectors) {
  let current = asElement(element);
  while (current) {
    if (matchesAny(current, selectors)) {
      return current;
    }
    current = current.parentElement ?? null;
  }
  return null;
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

export function shortenText(value, maxLength = 96) {
  const text = normalizeText(value);
  const graphemes = typeof Intl?.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
    : Array.from(text);
  if (graphemes.length <= maxLength) return text;
  return `${graphemes.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd()}…`;
}

export function elementText(element) {
  if (!element) {
    return "";
  }
  return normalizeText(typeof element.innerText === "string" ? element.innerText : element.textContent);
}

export function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseTranslateOffset(transform) {
  const value = String(transform ?? "");
  const translateY = value.match(/translateY\(\s*(-?[\d.]+)(?:px)?\s*\)/i);
  if (translateY) {
    return Number(translateY[1]);
  }
  const translate3d = value.match(/translate3d\(\s*(-?[\d.]+)(?:px)?\s*[, ]\s*(-?[\d.]+)(?:px)?/i);
  if (translate3d) {
    return Number(translate3d[2]);
  }
  const translate = value.match(/translate\(\s*(-?[\d.]+)(?:px)?(?:\s*[, ]\s*(-?[\d.]+)(?:px)?)?\s*\)/i);
  if (translate) {
    return Number(translate[2] ?? translate[1]);
  }
  const matrix = value.match(/matrix(?:3d)?\(([^)]+)\)/i);
  if (matrix) {
    const values = matrix[1].split(",").map((item) => Number(item.trim()));
    if (values.length === 6 && Number.isFinite(values[5])) {
      return values[5];
    }
    if (values.length === 16 && Number.isFinite(values[13])) {
      return values[13];
    }
  }
  return null;
}

export function safeIsConnected(element) {
  return Boolean(element && (element.isConnected === undefined || element.isConnected));
}
