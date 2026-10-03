export function nativeResult(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object")
    throw new Error(JSON.stringify({ detail: "计算后端返回了无效的响应。" }));
  const code = value.status_code;
  if (
    code !== undefined &&
    (!Number.isInteger(code) || code < 200 || code >= 300)
  )
    throw new Error(
      JSON.stringify({ detail: "计算后端执行失败，请检查运行环境后重试。" }),
    );
  if (value.error)
    throw new Error(
      JSON.stringify({ detail: "计算后端执行失败，请检查运行环境后重试。" }),
    );
  return value.result;
}
