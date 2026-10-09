import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { useWorkspaceStore } from "./workspace";
import { useRouteWorkbenchStore } from "./route-workbench";

const originalFetch = global.fetch;
const healthy = {
  "/api/v1/health": { route_search_ready: true, service_checks: { expand_one: true, template_relevance: true, fast_filter: true, gateway: true, commercial_stock: true, condition_recommender: true, forward_predictor: true, qm: true, solubility: true }, scientific_tools: { assessment: true, process: true } },
  "/api/v1/session": { mode: "local" },
  "/api/v1/template-library/health": { status: "ready" },
  "/api/v1/optimization/health": { ready: true },
  "/api/v1/references/status": { ready: true },
};
let failures;
beforeEach(() => {
  setActivePinia(createPinia());
  failures = new Set();
  global.fetch = jest.fn(async (url) => ({ ok: !failures.has(url), json: async () => healthy[url] }));
});
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test.each(["/api/v1/health", "/api/v1/session"])("failure of %s gates all execution without clearing chemical drafts", async (path) => {
  const workspace = useWorkspaceStore(), draft = useRouteWorkbenchStore();
  draft.smiles = "[Na+].CC(=O)[O-]";
  draft.name = "Preserved draft";
  draft.settings.minutes = 7;
  await workspace.refresh(true);
  expect(workspace.ready).toBe(true);
  expect(workspace.can("retro")).toBe(true);
  failures.add(path);
  await workspace.refresh(true);
  expect(workspace.ready).toBe(false);
  for (const feature of ["retro", "drawing", "stock", "templates", "conditions", "forward", "qm", "solubility", "assessment", "process", "optimization", "references"])
    expect(workspace.can(feature)).toBe(false);
  expect(workspace.error).toBeTruthy();
  expect(draft.smiles).toBe("[Na+].CC(=O)[O-]");
  expect(draft.name).toBe("Preserved draft");
  expect(draft.settings.minutes).toBe(7);
  failures.clear();
  await workspace.refresh(true);
  expect(workspace.ready).toBe(true);
  expect(workspace.can("retro")).toBe(true);
  expect(workspace.error).toBe("");
});

test.each([
  ["/api/v1/template-library/health", "templates"],
  ["/api/v1/optimization/health", "optimization"],
  ["/api/v1/references/status", "references"],
])("failed optional probe %s clears its previous capability only", async (path, feature) => {
  const workspace = useWorkspaceStore();
  await workspace.refresh(true);
  expect(workspace.can(feature)).toBe(true);
  failures.add(path);
  await workspace.refresh(true);
  expect(workspace.can(feature)).toBe(false);
  expect(workspace.ready).toBe(true);
  expect(workspace.can("retro")).toBe(true);
});

test("concurrent callers await one shared readiness refresh", async () => {
  const workspace = useWorkspaceStore(), releases = [];
  global.fetch.mockImplementation((url) => new Promise((resolve) => {
    releases.push(() => resolve({ ok: true, json: async () => healthy[url] }));
  }));
  const first = workspace.refresh(true), second = workspace.refresh(true);
  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(workspace.loading).toBe(true);
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  expect(workspace.ready).toBe(true);
  expect(workspace.loading).toBe(false);
  await workspace.refresh();
  expect(global.fetch).toHaveBeenCalledTimes(5);
});

test("a core-only caller shares the same probes and resolves before optional work", async () => {
  const workspace = useWorkspaceStore();
  let finish;
  global.fetch.mockImplementation(async (url) => url === "/api/v1/references/status"
    ? new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => healthy[url] }); })
    : { ok: true, json: async () => healthy[url] });
  const all = workspace.refresh(true);
  await workspace.refreshCore(true);
  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(workspace.ready).toBe(true); expect(workspace.loading).toBe(true);
  expect(workspace.probing.references).toBe(true);
  finish(); await all;
  expect(workspace.loading).toBe(false);
});

test("core-only readiness still exposes failed identity without awaiting optional timeout", async () => {
  const workspace = useWorkspaceStore();
  let finish;
  global.fetch.mockImplementation(async (url) => url === "/api/v1/references/status"
    ? new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => healthy[url] }); })
    : { ok: url !== "/api/v1/session", json: async () => healthy[url] });
  const all = workspace.refresh(true);
  await workspace.refreshCore(true);
  expect(workspace.session).toBeNull(); expect(workspace.ready).toBe(false);
  expect(workspace.error).toBeTruthy(); expect(workspace.loading).toBe(true);
  finish(); await all;
});

test("readiness timeout clears old success and always releases loading", async () => {
  const workspace = useWorkspaceStore();
  await workspace.refresh(true);
  jest.useFakeTimers();
  global.fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const pending = workspace.refresh(true);
  await jest.advanceTimersByTimeAsync(7000);
  await pending;
  expect(workspace.health).toBeNull();
  expect(workspace.session).toBeNull();
  expect(workspace.templates).toBeNull();
  expect(workspace.can("retro")).toBe(false);
  expect(workspace.loading).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test("a failed core probe gates immediately while an unrelated optional probe is still pending", async () => {
  const workspace = useWorkspaceStore();
  await workspace.refresh(true);
  jest.useFakeTimers();
  global.fetch.mockImplementation(async (url, { signal }) => {
    if (url === "/api/v1/references/status") return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { ok: url !== "/api/v1/health", json: async () => healthy[url] };
  });
  const pending = workspace.refresh(true);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(workspace.loading).toBe(true);
  expect(workspace.can("retro")).toBe(false);
  expect(workspace.ready).toBe(false);
  expect(workspace.error).toBeTruthy();
  await jest.advanceTimersByTimeAsync(7000);
  await pending;
  expect(workspace.loading).toBe(false);
});

test.each([
  ["/api/v1/template-library/health", "templates"],
  ["/api/v1/optimization/health", "optimization"],
  ["/api/v1/references/status", "references"],
])("a slow %s cannot delay confirmed core readiness or another optional capability", async (path, field) => {
  const workspace = useWorkspaceStore();
  let release;
  global.fetch.mockImplementation(async (url) => url === path ? new Promise(resolve => { release = resolve; })
    : { ok: true, json: async () => healthy[url] });
  const pending = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.ready).toBe(true); expect(workspace.can("retro")).toBe(true);
  expect(workspace.loading).toBe(true); expect(workspace.refreshed).toBeGreaterThan(0);
  expect(workspace.checking("retro")).toBe(false); expect(workspace.checking(field)).toBe(true);
  expect(workspace.can(field)).toBe(false);
  for (const other of ["templates", "optimization", "references"].filter(key => key !== field)) expect(workspace.can(other)).toBe(true);
  release({ ok: true, json: async () => healthy[path] }); await pending;
  expect(workspace.can(field)).toBe(true); expect(workspace.checking(field)).toBe(false);
  expect(workspace.loading).toBe(false);
});

test("core health and session publish atomically before pending optional responses", async () => {
  const workspace = useWorkspaceStore(); await workspace.refresh(true);
  const previous = workspace.health;
  let releaseSession, releaseReferences;
  global.fetch.mockImplementation(async (url) => {
    if (url === "/api/v1/session") return new Promise(resolve => { releaseSession = resolve; });
    if (url === "/api/v1/references/status") return new Promise(resolve => { releaseReferences = resolve; });
    return { ok: true, json: async () => url === "/api/v1/health" ? { ...healthy[url], route_search_ready: false } : healthy[url] };
  });
  const pending = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.health).toBe(previous);
  releaseSession({ ok: true, json: async () => healthy["/api/v1/session"] });
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.health.route_search_ready).toBe(false);
  expect(workspace.ready).toBe(false); expect(workspace.loading).toBe(true);
  releaseReferences({ ok: true, json: async () => healthy["/api/v1/references/status"] }); await pending;
});

test("known core failure stops connecting status despite an unfinished optional probe", async () => {
  const workspace = useWorkspaceStore();
  let release;
  global.fetch.mockImplementation(async (url) => url === "/api/v1/references/status" ? new Promise(resolve => { release = resolve; })
    : { ok: url !== "/api/v1/health", json: async () => healthy[url] });
  const pending = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.error).toBeTruthy(); expect(workspace.checking("retro")).toBe(false);
  expect(workspace.can("retro")).toBe(false);
  release({ ok: true, json: async () => healthy["/api/v1/references/status"] }); await pending;
});

test("a fresh snapshot replaces missing capabilities and roles instead of deep-merging old successes", async () => {
  const workspace = useWorkspaceStore();
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url === "/api/v1/session"
    ? { mode: "askcos", administrator: true } : healthy[url] }));
  await workspace.refresh(true); expect(workspace.can("administrator")).toBe(true);
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => url === "/api/v1/session"
    ? { mode: "askcos" } : url === "/api/v1/health" ? { route_search_ready: false, service_checks: {}, scientific_tools: {} } : healthy[url] }));
  await workspace.refresh(true);
  expect(workspace.can("administrator")).toBe(false); expect(workspace.can("retro")).toBe(false);
  expect(workspace.health.service_checks).toEqual({});
});

test("synchronous observers never see a new health snapshot paired with an old session", async () => {
  const workspace = useWorkspaceStore(); let epoch = 1;
  global.fetch.mockImplementation(async (url) => ({ ok: true, json: async () => ["/api/v1/health", "/api/v1/session"].includes(url)
    ? { ...healthy[url], fixture_epoch: epoch } : healthy[url] }));
  await workspace.refresh(true);
  const observed = [];
  const stop = watch(() => [workspace.health?.fixture_epoch, workspace.session?.fixture_epoch], value => observed.push(value), { flush: "sync" });
  epoch = 2; await workspace.refresh(true); stop();
  expect(observed).toEqual([[2, 2]]);
});

test.each([["/api/v1/health", []], ["/api/v1/health", { route_search_ready: "true" }],
  ["/api/v1/session", []], ["/api/v1/session", { mode: "unknown" }]])("malformed core %s cannot create readiness: %j", async (path, value) => {
  const workspace = useWorkspaceStore();
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === path ? value : healthy[url] }));
  await workspace.refresh(true);
  expect(workspace.ready).toBe(false); expect(workspace.can("retro")).toBe(false);
  expect(workspace.error).toBeTruthy();
});

test("deadline releases a stalled JSON body and late optional data cannot overwrite a newer refresh", async () => {
  const workspace = useWorkspaceStore(); jest.useFakeTimers();
  let release;
  global.fetch.mockImplementation(async url => ({ ok: true, json: () => url === "/api/v1/references/status"
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve(healthy[url]) }));
  const pending = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.ready).toBe(true);
  await jest.advanceTimersByTimeAsync(7000); await pending;
  expect(workspace.references).toBeNull(); expect(workspace.loading).toBe(false);
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => healthy[url] }));
  await workspace.refresh(true); expect(workspace.references.ready).toBe(true);
  release({ ready: false });
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.references.ready).toBe(true); expect(jest.getTimerCount()).toBe(0);
});

test("reconnect bypasses the freshness cache and confirms current core identity and readiness", async () => {
  const workspace = useWorkspaceStore(); await workspace.refresh(true);
  expect(global.fetch).toHaveBeenCalledTimes(5);
  await workspace.reconnect();
  expect(global.fetch).toHaveBeenCalledTimes(10);
  expect(workspace.ready).toBe(true); expect(workspace.error).toBe("");
});

test("reconnect behind an unfinished offline probe is coalesced and uses a new snapshot", async () => {
  const workspace = useWorkspaceStore();
  let release;
  global.fetch.mockImplementation(async url => url === "/api/v1/references/status"
    ? new Promise(resolve => { release = () => resolve({ ok: false }); })
    : { ok: url !== "/api/v1/health", json: async () => healthy[url] });
  const old = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  expect(workspace.error).toBeTruthy(); expect(workspace.loading).toBe(true);
  const first = workspace.reconnect(), second = workspace.reconnect();
  expect(global.fetch).toHaveBeenCalledTimes(5);
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => healthy[url] }));
  release(); await Promise.all([old, first, second]);
  expect(global.fetch).toHaveBeenCalledTimes(10);
  expect(workspace.ready).toBe(true); expect(workspace.error).toBe("");
  expect(workspace.references.ready).toBe(true); expect(workspace.loading).toBe(false);
});

test("reconnect does not wait for a stalled optional probe and late old data cannot overwrite it", async () => {
  jest.useFakeTimers();
  const workspace = useWorkspaceStore(); let release;
  global.fetch.mockImplementation(async url => url === "/api/v1/references/status"
    ? new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ready: false }) }); })
    : { ok: url !== "/api/v1/health", json: async () => healthy[url] });
  const old = workspace.refresh(true);
  for (let i = 0; i < 24; i++) await Promise.resolve();
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => healthy[url] }));
  let resolved = false;
  const retry = workspace.reconnect().then(() => { resolved = true; });
  try {
    await jest.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(true);
    expect(workspace.ready).toBe(true); expect(workspace.references.ready).toBe(true);
    release(); await jest.advanceTimersByTimeAsync(1);
    expect(workspace.references.ready).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  } finally { release(); await Promise.all([old, retry]); }
});
