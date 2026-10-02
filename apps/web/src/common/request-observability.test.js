import { recordRequest, safePreview } from "./request-observability";

test("does not retain credentials or full large responses", () => {
  const preview = safePreview({ password: "private", nested: { access_token: "private" }, rows: Array(100).fill({ value: "x".repeat(10000) }) });
  expect(preview.password).toBe("[redacted]");
  expect(preview.nested.access_token).toBe("[redacted]");
  expect(preview.rows).toHaveLength(5);
  expect(preview.rows[0].value).toHaveLength(500);
});

test("request diagnostics remain bounded during long polling", () => {
  const store = { requestHistory: [] };
  for (let i = 0; i < 1000; i += 1) recordRequest(store, { endpoint: "/api/v1/health", request: { index: i } });
  expect(store.requestHistory).toHaveLength(40);
  expect(store.requestHistory[0].request.index).toBe(999);
});
