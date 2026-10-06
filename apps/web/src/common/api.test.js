const fs = require("fs");
const path = require("path");
const { API } = require("@/common/api");
const { createPinia, setActivePinia } = require("pinia");
const { hasWorkspaceAccess } = require("./workspace-session");

jest.mock("./workspace-session", () => ({ hasWorkspaceAccess: jest.fn() }));
const originalFetch = global.fetch;
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  setActivePinia(createPinia());
  global.fetch = jest.fn();
  localStorage.clear();
  hasWorkspaceAccess.mockResolvedValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
});

const apiPath = path.resolve(__dirname, "api.js");

function readApi() {
  return fs.readFileSync(apiPath, "utf8");
}

test("expired sessions never recover by retaining plaintext passwords", () => {
  const text = readApi();

  expect(text).not.toContain("recoverGuestSession");
  expect(text).toContain("guestPassword");
  expect(text).not.toContain('getItem("guestPassword")');
  expect(text).toContain('response.status === 401');
  expect(text).toContain('endpoint !== "/api/admin/token"');
  expect(text).not.toContain("return this.request(method, endpoint, data, query, false)");
  expect(text).toContain("redirectToLogin");
});

test("localizes generic celery task failures with caller fallback", () => {
  const errorObj = API.toErrorObject(
    new Error("Task failed!"),
    "可合成性评估失败，请检查分子输入、模型服务和后端任务状态。"
  );

  expect(errorObj).toStrictEqual({
    string_error: "可合成性评估失败，请检查分子输入、模型服务和后端任务状态。",
  });
});

test("preserves structured backend error details", () => {
  const errorObj = API.toErrorObject(
    new Error(JSON.stringify({ detail: "模型服务未响应" }))
  );

  expect(errorObj).toStrictEqual({
    detail: "模型服务未响应",
    string_error: "模型服务未响应",
  });
});

test("removing the unmounted chat leaves no separate browser RPC transport", () => {
  expect(API.jsonRpc).toBeUndefined();
});

test("request options preserve query, credentials and authentication headers", async () => {
  localStorage.setItem("accessToken", "synthetic-test-token");
  global.fetch.mockResolvedValue(reply({ value: 1 }));
  await API.get("/api/test", { query: "CCO" }, true, { timeoutMs: 500 });
  expect(global.fetch).toHaveBeenCalledWith("/api/test?query=CCO", expect.objectContaining({
    method: "GET", credentials: "include", headers: expect.objectContaining({ Authorization: "Bearer synthetic-test-token" }),
  }));
  expect(jest.getTimerCount()).toBe(0);
});

test.each([false, true])("received 401 keeps the existing workspace-access decision: %s", async (access) => {
  localStorage.setItem("accessToken", "expired-test-token");
  hasWorkspaceAccess.mockResolvedValue(access);
  global.fetch.mockResolvedValue(reply({ detail: "expired" }, 401));
  const redirect = jest.spyOn(API, "redirectToLogin").mockImplementation(() => {});
  await expect(API.get("/api/test", null, false)).rejects.toThrow("expired");
  expect(redirect).toHaveBeenCalledTimes(access ? 0 : 1);
  expect(localStorage.getItem("accessToken")).toBe(access ? "expired-test-token" : null);
});

test("the token endpoint is still excluded from the 401 redirect path", async () => {
  global.fetch.mockResolvedValue(reply({ detail: "invalid login" }, 401));
  const redirect = jest.spyOn(API, "redirectToLogin").mockImplementation(() => {});
  await expect(API.post("/api/admin/token", {})).rejects.toThrow("invalid login");
  expect(hasWorkspaceAccess).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

test("a caller can abort a stalled request without authentication side effects", async () => {
  const controller = new AbortController();
  global.fetch.mockImplementation(() => new Promise(() => {}));
  const redirect = jest.spyOn(API, "redirectToLogin").mockImplementation(() => {});
  const pending = API.get("/api/test", null, false, { signal: controller.signal });
  const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await check;
  expect(redirect).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["transport", "body"])("request timeout bounds a stalled %s", async (stage) => {
  global.fetch.mockImplementation(() => stage === "transport"
    ? new Promise(() => {})
    : Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
  const pending = API.get("/api/test", null, false, { timeoutMs: 50 });
  const check = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  await flush();
  await jest.advanceTimersByTimeAsync(50);
  await check;
  expect(jest.getTimerCount()).toBe(0);
});

test("polling follows the existing status endpoint without resubmitting or cancelling the remote operation", async () => {
  global.fetch
    .mockResolvedValueOnce(reply({ task_id: "task-a" }))
    .mockResolvedValueOnce(reply({ complete: false, failed: false }))
    .mockResolvedValueOnce(reply({ complete: true, failed: false, output: ["result"] }));
  const pending = API.runCeleryTask("/api/model/call-async", { smiles: "CCO" });
  await flush();
  await jest.advanceTimersByTimeAsync(API.pollInterval);
  expect(await pending).toEqual(["result"]);
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/model/call-async", "/api/legacy/celery/task/task-a/", "/api/legacy/celery/task/task-a/",
  ]);
  expect(jest.getTimerCount()).toBe(0);
});

test("unmount cancellation clears a scheduled poll and suppresses late progress", async () => {
  global.fetch.mockResolvedValue(reply({ complete: false }));
  const controller = new AbortController(), progress = jest.fn();
  const pending = API.pollCeleryResult("task-a", progress, { signal: controller.signal });
  const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await flush();
  expect(progress).toHaveBeenCalledTimes(1);
  controller.abort();
  await check;
  await jest.advanceTimersByTimeAsync(5000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("an aborted late submission never starts result polling", async () => {
  let resolve;
  global.fetch.mockImplementation(() => new Promise((yes) => { resolve = yes; }));
  const controller = new AbortController();
  const pending = API.runCeleryTask("/api/model/call-async", {}, undefined, { signal: controller.signal });
  const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await check;
  resolve(reply({ task_id: "late-task" }));
  await flush();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("polling has a whole-operation deadline", async () => {
  global.fetch.mockResolvedValue(reply({ complete: false }));
  const pending = API.pollCeleryResult("task-a", null, { timeoutMs: 50 });
  const check = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  await flush();
  await jest.advanceTimersByTimeAsync(50);
  await check;
  expect(jest.getTimerCount()).toBe(0);
});

test("consecutive transport failures stop after a bounded number of reads", async () => {
  global.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
  const pending = API.pollCeleryResult("task-a");
  const check = expect(pending).rejects.toThrow("Failed to fetch");
  await flush();
  await jest.advanceTimersByTimeAsync(API.pollIntervalLong * 2);
  await check;
  expect(global.fetch).toHaveBeenCalledTimes(API.maxPollConnectionErrors);
  expect(jest.getTimerCount()).toBe(0);
});

test("completed native failures remain failures and dispose polling immediately", async () => {
  global.fetch.mockResolvedValue(reply({ complete: true, failed: true, output: { detail: "native task failed" } }));
  await expect(API.pollCeleryResult("task-a")).rejects.toThrow("native task failed");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test("HTTP failures are not hidden by the transport retry policy", async () => {
  global.fetch.mockResolvedValue(reply({ detail: "native unavailable" }, 503));
  await expect(API.pollCeleryResult("task-a")).rejects.toThrow("native unavailable");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([0, -1, NaN, Infinity])("invalid polling deadlines cannot start a poll: %s", async (timeoutMs) => {
  await expect(API.pollCeleryResult("task-a", null, { timeoutMs })).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});
