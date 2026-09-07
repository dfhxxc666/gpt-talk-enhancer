const REQUEST_LABEL = /^(?:my request|request|\u6211\u7684\u8bf7\u6c42|\u6211\u7684\u95ee\u9898)$/i;
const WRAPPER_LABEL = /^(?:selected text|selection\s+\d+)$/i;

export function normalizeQuestionDisplayText(value) {
  const raw = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return "";

  const request = extractRequestSection(raw);
  const candidate = request || stripWrapperLabels(raw);
  const cleaned = cleanMarkdownNoise(candidate);
  if (cleaned) return cleaned;

  return collapseWhitespace(stripWrapperLabels(raw)) || collapseWhitespace(raw);
}

export function extractRequestSection(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  let matchIndex = -1;
  let inline = "";
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseLabelLine(lines[index]);
    if (!parsed || !REQUEST_LABEL.test(parsed.label)) continue;
    matchIndex = index;
    inline = parsed.rest;
  }
  if (matchIndex < 0) return "";
  return [inline, ...lines.slice(matchIndex + 1)].filter(Boolean).join("\n").trim();
}

function stripWrapperLabels(value) {
  return String(value ?? "")
    .split("\n")
    .filter((line) => {
      const parsed = parseLabelLine(line);
      if (parsed && WRAPPER_LABEL.test(parsed.label)) return false;
      const heading = String(line ?? "").match(/^\s*#{1,6}\s+(.+?)\s*$/);
      return !(heading && WRAPPER_LABEL.test(heading[1].trim()));
    })
    .join("\n");
}

function parseLabelLine(line) {
  const match = String(line ?? "").match(/^\s*(?:#{1,6}\s*)?([^:\uFF1A]+)[:\uFF1A]\s*(.*)$/);
  if (!match) return null;
  return { label: match[1].trim(), rest: match[2].trim() };
}

function cleanMarkdownNoise(value) {
  return collapseWhitespace(
    String(value ?? "")
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/~~~[\s\S]*?~~~/g, " [code] ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/`([^`]+)`/g, "$1")
  );
}

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}