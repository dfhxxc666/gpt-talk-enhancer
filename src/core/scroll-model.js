export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function getMaxLogicalPosition(scrollHeight, clientHeight) {
  return Math.max(0, Number(scrollHeight || 0) - Number(clientHeight || 0));
}

export function logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse) {
  const max = Math.max(0, Number(maxLogicalPosition || 0));
  const physical = Number(scrollTop || 0);
  if (isColumnReverse) {
    return clamp(max + physical, 0, max);
  }
  return clamp(physical, 0, max);
}

export function scrollTopFromLogical(logicalPosition, maxLogicalPosition, isColumnReverse) {
  const max = Math.max(0, Number(maxLogicalPosition || 0));
  const logical = clamp(Number(logicalPosition || 0), 0, max);
  if (isColumnReverse) {
    return logical - max;
  }
  return logical;
}

export function createScrollModel({ scrollTop = 0, scrollHeight = 0, clientHeight = 0, flexDirection = "column" } = {}) {
  const isColumnReverse = flexDirection === "column-reverse";
  const maxLogicalPosition = getMaxLogicalPosition(scrollHeight, clientHeight);
  return Object.freeze({
    scrollTop: Number(scrollTop || 0),
    scrollHeight: Number(scrollHeight || 0),
    clientHeight: Number(clientHeight || 0),
    flexDirection,
    isColumnReverse,
    minLogicalPosition: 0,
    maxLogicalPosition,
    logicalPosition: logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse),
    minScrollTop: isColumnReverse ? -maxLogicalPosition : 0,
    maxScrollTop: isColumnReverse ? 0 : maxLogicalPosition
  });
}
