const SENSITIVE = /password|secret|token|api.?key|authorization|cookie/i;

function safePreview(value, depth = 0) {
  if (depth > 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 5).map(item => safePreview(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) =>
      [key, SENSITIVE.test(key) ? "[redacted]" : safePreview(item, depth + 1)]));
  }
  return typeof value === "string" ? value.slice(0, 500) : value;
}

function recordRequest(store, entry) {
  store.requestHistory.unshift({ ...entry, request: safePreview(entry.request), response: safePreview(entry.response) });
  store.requestHistory.splice(40);
}

export { recordRequest, safePreview };
