import { reactive } from "vue";
import { API } from "@/common/api";
import { createRuleOwnerScope, ruleRequestOptions, ruleRequestTimeoutMs } from "./rule-owner-scope";
import { rulePostPath } from "./rule-file";
import { session } from "./rule-protocol.test-support";

jest.mock("@/store/fastapi", () => ({ useFastapiStore: () => ({ requestHistory: [] }) }));
jest.mock("@/common/workspace-session", () => ({ hasWorkspaceAccess: jest.fn() }));
const originalFetch = global.fetch;
let workspace, scope;
beforeEach(() => {
  workspace = reactive({ session: session(), error: "", can: () => true });
  scope = createRuleOwnerScope(workspace);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
});
afterEach(() => { scope.dispose(); global.fetch = originalFetch; });

test("rule posts use the real shared transport, native query semantics and unchanged source identity", async () => {
  const ticket = scope.begin(), entry = { description: "source + note", smiles: "[13CH3][C@H](O)C.[Cl-]", active: false };
  const path = rulePostPath("chemicals", entry);
  await API.post(path, undefined, false, ruleRequestOptions(ticket));
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe(path); expect(options.method).toBe("POST"); expect(options.credentials).toBe("include");
  expect(options.body).toBeUndefined(); expect(options.signal).toBeInstanceOf(AbortSignal);
  const values = Object.fromEntries(new URLSearchParams(url.split("?")[1]));
  expect(values).toEqual({ ...entry, active: "false" });
  expect(ruleRequestOptions(ticket).timeoutMs).toBe(ruleRequestTimeoutMs);
});

test.each(["GET", "POST", "DELETE"])("owner change aborts real %s transport and its late reply cannot succeed", async (method) => {
  let resolve;
  global.fetch.mockReturnValue(new Promise(done => { resolve = done; }));
  const ticket = scope.begin(), path = `/api/banlist/chemicals/${method === "GET" ? "get" : method === "POST" ? "post" : "delete"}`;
  const attempt = API.request(method, path, null, false, ruleRequestOptions(ticket));
  const check = expect(attempt).rejects.toMatchObject({ name: "AbortError" });
  workspace.session = session("protocol-B");
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await check;
  resolve({ ok: true, json: async () => [] });
  expect(scope.active(ticket)).toBe(false);
});

test("shared transport bounds a stalled rule response body and permits a new explicit request", async () => {
  jest.useFakeTimers();
  try {
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) });
    const ticket = scope.begin();
    const attempt = API.get("/api/banlist/chemicals/get", null, false, ruleRequestOptions(ticket));
    const check = expect(attempt).rejects.toMatchObject({ name: "TimeoutError" });
    await jest.advanceTimersByTimeAsync(ruleRequestTimeoutMs); await check;
    scope.finish(ticket); expect(jest.getTimerCount()).toBe(0);
    await expect(API.get("/api/banlist/chemicals/get", null, false, ruleRequestOptions(scope.begin()))).resolves.toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
