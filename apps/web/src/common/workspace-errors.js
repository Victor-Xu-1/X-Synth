export function errorMessage(error, fallback = "请求未完成，请重试。") {
  try {
    const value = JSON.parse(error.message);
    if (typeof value.detail === "string") return value.detail;
    if (Array.isArray(value.detail))
      return value.detail.map((item) => item.msg).join("；");
  } catch {
    /* Network errors have no structured API detail. */
  }
  return error?.name === "AbortError" ? "请求已取消。" : fallback;
}
