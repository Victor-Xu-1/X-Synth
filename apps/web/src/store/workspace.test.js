import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { visibleNavigation } from "@/common/workspace-navigation";
import { useWorkspaceStore } from "./workspace";
import { stopWorkspaceProbes } from "./workspace-probes";
import { useRouteWorkbenchStore } from "./route-workbench";

const originalFetch = global.fetch;
const healthyOptimization = { ready: true, reason: "Protocol fixture", versions: { baybe: "0.15.0" }, fresh_for_seconds: 60 };
const healthy = {
  "/api/v1/health": { route_search_ready: true, service_checks: { expand_one: true, template_relevance: true, fast_filter: true, gateway: true, commercial_stock: true, condition_recommender: true, forward_predictor: true, qm: true, solubility: true }, scientific_tools: { assessment: true, process: true }, scientific_engines: { optimization: healthyOptimization } },
  "/api/v1/session": { mode: "local" },
  "/api/v1/template-library/health": { status: "ready" },
  "/api/v1/optimization/health": { ready: true },
  "/api/v1/references/status": { ready: true },
};
let failures;
beforeEach(() => {
  setActivePinia(createPinia());
  failures = new Set();
  global.fetch = jest.fn(async (url) => ({ ok: !failures.has(url), json: async () =>
    url === "/api/v1/health" && failures.has("/api/v1/optimization/health")
      ? { ...healthy[url], scientific_engines: { optimization: { ...healthyOptimization, ready: false } } }
      : healthy[url] }));
});
afterEach(() => { stopWorkspaceProbes(useWorkspaceStore()); global.fetch = originalFetch; localStorage.clear(); jest.useRealTimers(); });

test("core-only dispatch never starts optional probes", async () => {
  const workspace = useWorkspaceStore();
  await workspace.refreshCore(true);
  expect(global.fetch.mock.calls.map(([url]) => url).sort()).toEqual(["/api/v1/health", "/api/v1/session"]);
  expect(workspace.probing.templates).toBe(false);
  expect(workspace.probing.optimization).toBe(false);
});

test.each(["__proto__", "constructor", "unknown"])("unsupported optional feature %s cannot dispatch a probe", async feature => {
  const workspace = useWorkspaceStore();
  await workspace.refreshFeature(feature, true);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("generic shell refresh never invokes the active optimization endpoint", async () => {
  await useWorkspaceStore().refresh(true);
  expect(global.fetch.mock.calls.map(([url]) => url)).not.toContain("/api/v1/optimization/health");
});

test("core refresh replaces old identity headers and rejects their late publication", async () => {
  const workspace = useWorkspaceStore();
  const releases = [];
  localStorage.setItem("accessToken", "old-fixture-identity");
  global.fetch.mockImplementation((url, { headers }) => headers.Authorization === "Bearer old-fixture-identity"
    ? new Promise(resolve => releases.push(() => resolve({ ok: true, json: async () => healthy[url] })))
    : Promise.resolve({ ok: true, json: async () => url.endsWith("/session")
      ? { mode: "askcos", owner: "new-fixture-owner" } : healthy[url] }));
  const old = workspace.refreshCore(true);
  localStorage.setItem("accessToken", "new-fixture-identity");
  const current = workspace.refreshCore(true);
  expect(global.fetch.mock.calls.filter(([url]) => ["/api/v1/health", "/api/v1/session"].includes(url))).toHaveLength(4);
  releases.forEach(release => release());
  await Promise.all([old, current]);
  expect(workspace.session.owner).toBe("new-fixture-owner");
});

test("explicit feature verification publishes to the same workspace capability", async () => {
  const workspace = useWorkspaceStore();
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => url === "/api/v1/health"
    ? { ...healthy[url], scientific_engines: {} } : healthy[url] }));
  await workspace.refreshCore(true);
  expect(workspace.can("optimization")).toBe(false);
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ready: true, reason: "Protocol fixture",
    versions: { baybe: "0.15.0" }, fresh_for_seconds: 60 }) });
  await workspace.refreshFeature("optimization", true);
  expect(workspace.optimization.ready).toBe(true);
  expect(workspace.can("optimization")).toBe(true);
});

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
])("failed optional evidence %s clears its previous capability only", async (path, feature) => {
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
  expect(global.fetch).toHaveBeenCalledTimes(4);
  expect(workspace.loading).toBe(true);
  releases.forEach((release) => release());
  await Promise.all([first, second]);
  expect(workspace.ready).toBe(true);
  expect(workspace.loading).toBe(false);
  await workspace.refresh();
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test("a core-only caller shares the same probes and resolves before optional work", async () => {
  const workspace = useWorkspaceStore();
  let finish;
  global.fetch.mockImplementation(async (url) => url === "/api/v1/references/status"
    ? new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => healthy[url] }); })
    : { ok: true, json: async () => healthy[url] });
  const all = workspace.refresh(true);
  await workspace.refreshCore(true);
  expect(global.fetch).toHaveBeenCalledTimes(4);
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
  expect(workspace.references.ready).toBe(true);
  expect(jest.getTimerCount()).toBe(1);
  stopWorkspaceProbes(workspace); expect(jest.getTimerCount()).toBe(0);
});

test("reconnect bypasses the freshness cache and confirms current core identity and readiness", async () => {
  const workspace = useWorkspaceStore(); await workspace.refresh(true);
  expect(global.fetch).toHaveBeenCalledTimes(4);
  await workspace.reconnect();
  expect(global.fetch).toHaveBeenCalledTimes(8);
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
  global.fetch.mockImplementation(async url => ({ ok: true, json: async () => healthy[url] }));
  const first = workspace.reconnect(), second = workspace.reconnect();
  expect(global.fetch).toHaveBeenCalledTimes(8);
  release(); await Promise.all([old, first, second]);
  expect(global.fetch).toHaveBeenCalledTimes(8);
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
    expect(jest.getTimerCount()).toBe(1);
    stopWorkspaceProbes(workspace); expect(jest.getTimerCount()).toBe(0);
  } finally { release(); await Promise.all([old, retry]); }
});


const settle = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferredRead = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const reply = value => ({ ok: true, json: async () => value });

test("expired verified capability stays discoverable but cannot execute or start a worker", async () => {
  jest.useFakeTimers();
  const workspace = useWorkspaceStore(); await workspace.refreshCore(true);
  expect(workspace.can("optimization")).toBe(true);
  const calls = global.fetch.mock.calls.length;
  await jest.advanceTimersByTimeAsync(60000);
  expect(workspace.features.optimization).toBe(true);
  expect(workspace.can("optimization")).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(calls);
});

test.each([
  {}, { fresh_for_seconds: 0 }, { fresh_for_seconds: "60" }, { fresh_for_seconds: true },
  { fresh_for_seconds: 61 }, { fresh_for_seconds: -1 }, { fresh_for_seconds: Infinity },
  { versions: { baybe: "wrong-version" } }, { ready: "true" }, { checking: "false" },
])("unverified or malformed passive optimization evidence never authorizes execution: %j", async patch => {
  const workspace = useWorkspaceStore();
  const value = { ...healthyOptimization, ...patch };
  if (!Object.keys(patch).length) delete value.fresh_for_seconds;
  global.fetch.mockImplementation(async url => reply(url === "/api/v1/health"
    ? { ...healthy[url], scientific_engines: { optimization: value } } : healthy[url]));
  await workspace.refreshCore(true);
  expect(workspace.ready).toBe(true);
  expect(workspace.can("optimization")).toBe(false);
  expect(global.fetch.mock.calls.map(([url]) => url)).not.toContain("/api/v1/optimization/health");
});

test("a core response begun during verification cannot overwrite its newer completed feature evidence", async () => {
  const workspace = useWorkspaceStore(); await workspace.refreshCore(true);
  const healthBody = deferredRead(), feature = deferredRead();
  global.fetch.mockImplementation(async url => url.endsWith("/optimization/health") ? feature.promise
    : url === "/api/v1/health" ? { ok: true, json: () => healthBody.promise } : reply(healthy[url]));
  const active = workspace.refreshFeature("optimization", true);
  const coreRead = workspace.refreshCore(true);
  feature.resolve(reply(healthyOptimization)); await active;
  expect(workspace.can("optimization")).toBe(true);
  healthBody.resolve({ ...healthy["/api/v1/health"],
    scientific_engines: { optimization: { ...healthyOptimization, ready: false } } });
  await coreRead;
  expect(workspace.can("optimization")).toBe(true);
});

test("a replacement subscriber never joins an aborted feature request or accepts its late evidence", async () => {
  const workspace = useWorkspaceStore(); await workspace.refreshCore(true);
  const held = deferredRead(), controller = new AbortController();
  global.fetch.mockReturnValueOnce(held.promise).mockResolvedValue(reply({ ...healthyOptimization, ready: false }));
  const old = workspace.refreshFeature("optimization", true, { signal: controller.signal });
  controller.abort();
  const current = workspace.refreshFeature("optimization", true);
  expect(global.fetch).toHaveBeenCalledTimes(4);
  held.resolve(reply(healthyOptimization)); await Promise.all([old, current]);
  expect(workspace.optimization.ready).toBe(false);
});

test("one feature consumer cannot cancel another consumer's shared verification", async () => {
  const workspace = useWorkspaceStore(); await workspace.refreshCore(true);
  const held = deferredRead(), first = new AbortController(), second = new AbortController();
  let signal;
  global.fetch.mockImplementation(async (_url, options) => { signal = options.signal; return held.promise; });
  const a = workspace.refreshFeature("optimization", true, { signal: first.signal });
  const b = workspace.refreshFeature("optimization", true, { signal: second.signal });
  first.abort(); await a;
  expect(signal.aborted).toBe(false);
  held.resolve(reply(healthyOptimization)); await b;
  expect(workspace.can("optimization")).toBe(true);
});

test("active verification deadline releases a stalled body and cannot publish late success", async () => {
  jest.useFakeTimers();
  const workspace = useWorkspaceStore(); await workspace.refreshCore(true);
  const held = deferredRead();
  global.fetch.mockResolvedValue({ ok: true, json: () => held.promise });
  const pending = workspace.refreshFeature("optimization", true);
  await jest.advanceTimersByTimeAsync(25000); await pending;
  expect(workspace.probing.optimization).toBe(false);
  expect(workspace.can("optimization")).toBe(false);
  held.resolve(healthyOptimization); await settle();
  expect(workspace.can("optimization")).toBe(false);
});

test("transport time cannot extend a verified snapshot's remaining lifetime", async () => {
  jest.useFakeTimers();
  const workspace = useWorkspaceStore(), held = deferredRead();
  global.fetch.mockImplementation(async url => url === "/api/v1/health"
    ? { ok: true, json: () => held.promise } : reply(healthy[url]));
  const pending = workspace.refreshCore(true);
  await jest.advanceTimersByTimeAsync(1500);
  held.resolve({ ...healthy["/api/v1/health"],
    scientific_engines: { optimization: { ...healthyOptimization, fresh_for_seconds: 1 } } });
  await pending;
  expect(workspace.can("optimization")).toBe(false);
});

test("a wall-clock correction cannot extend optimization verification lifetime", async () => {
  jest.useFakeTimers();
  const workspace = useWorkspaceStore(), held = deferredRead();
  global.fetch.mockImplementation(async url => url === "/api/v1/health"
    ? { ok: true, json: () => held.promise } : reply(healthy[url]));
  const pending = workspace.refreshCore(true);
  jest.setSystemTime(Date.now() - 120000);
  held.resolve(healthy["/api/v1/health"]); await pending;
  expect(workspace.can("optimization")).toBe(true);
  await jest.advanceTimersByTimeAsync(60000);
  expect(workspace.can("optimization")).toBe(false);
});

test("cold configured optimization is discoverable but waits for explicit verified readiness", async () => {
  const workspace = useWorkspaceStore();
  const cold = { ready: false, reason: "not_probed", configured: true, fresh_for_seconds: 0 };
  global.fetch.mockImplementation(async url => reply(url === "/api/v1/health"
    ? { ...healthy[url], scientific_engines: { optimization: cold } } : healthy[url]));
  await workspace.refreshCore(true);
  const listed = () => visibleNavigation(workspace.features).flatMap(group => group.items).some(item => item.id === "optimization");
  expect(listed()).toBe(true);
  expect(workspace.can("optimization")).toBe(false);
  expect(global.fetch.mock.calls.map(([url]) => url)).not.toContain("/api/v1/optimization/health");
  const held = deferredRead();
  global.fetch.mockReturnValueOnce(held.promise);
  const pending = workspace.refreshFeature("optimization");
  expect(workspace.can("optimization")).toBe(false);
  held.resolve(reply({ ...healthyOptimization, configured: true }));
  await pending;
  expect(workspace.can("optimization")).toBe(true);
  expect(listed()).toBe(true);
});

test.each([
  { ready: false, reason: "not_probed", configured: false },
  { ready: false, reason: "Legacy unprobed" },
  { ...healthyOptimization, configured: false },
])("unconfigured optimization is not advertised: %j", async value => {
  const workspace = useWorkspaceStore();
  global.fetch.mockImplementation(async url => reply(url === "/api/v1/health"
    ? { ...healthy[url], scientific_engines: { optimization: value } } : healthy[url]));
  await workspace.refreshCore(true);
  expect(visibleNavigation(workspace.features).flatMap(group => group.items).some(item => item.id === "optimization")).toBe(false);
  expect(workspace.can("optimization")).toBe(false);
});

test("configured failed verification remains discoverable but a positive cache lifetime cannot execute", async () => {
  const workspace = useWorkspaceStore();
  await workspace.refreshCore(true);
  global.fetch.mockResolvedValueOnce(reply({ configured: true, ready: false, reason: "Probe failed", fresh_for_seconds: 60 }));
  await workspace.refreshFeature("optimization", true);
  expect(workspace.features.optimization).toBe(true);
  expect(workspace.optimizationExpires).toBeGreaterThan(performance.now());
  expect(workspace.can("optimization")).toBe(false);
  global.fetch.mockRejectedValueOnce(new Error("Fixture transport failure"));
  await workspace.refreshFeature("optimization", true);
  expect(workspace.features.optimization).toBe(true);
  expect(workspace.can("optimization")).toBe(false);
});

test.each([1, "true", null])("malformed configured metadata cannot advertise or authorize optimization: %j", async configured => {
  const workspace = useWorkspaceStore();
  global.fetch.mockImplementation(async url => reply(url === "/api/v1/health"
    ? { ...healthy[url], scientific_engines: { optimization: { ...healthyOptimization, configured } } } : healthy[url]));
  await workspace.refreshCore(true);
  expect(workspace.features.optimization).toBe(false);
  expect(workspace.can("optimization")).toBe(false);
});

test.each(["getItem", "accessor"])("storage denial at %s revokes current readiness without throwing or anonymous fallback", async kind => {
  const workspace = useWorkspaceStore();
  localStorage.setItem("accessToken", "fixture-owner-a");
  await workspace.refreshCore(true);
  const calls = global.fetch.mock.calls.length;
  const denied = kind === "getItem" ? jest.spyOn(Storage.prototype, "getItem")
    : jest.spyOn(window, "localStorage", "get");
  denied.mockImplementation(() => { throw new Error("Fixture storage denied"); });
  try {
    expect(() => workspace.can("optimization")).not.toThrow();
    expect(workspace.can("optimization")).toBe(false);
    expect(() => workspace.refreshCore(true)).not.toThrow();
    await workspace.refreshCore(true);
    await workspace.refreshFeature("optimization", true);
    await workspace.reconnect();
    expect(global.fetch).toHaveBeenCalledTimes(calls);
    expect(workspace.loading).toBe(false);
    expect(workspace.ready).toBe(false);
  } finally { denied.mockRestore(); }
  expect(workspace.can("optimization")).toBe(false);
  await workspace.refreshCore(true);
  expect(workspace.can("optimization")).toBe(true);
});

test("storage denial before ownership cannot dispatch anonymous probes", async () => {
  const workspace = useWorkspaceStore();
  const denied = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Fixture storage denied"); });
  try {
    expect(() => workspace.refreshCore(true)).not.toThrow();
    await workspace.refreshCore(true);
    await workspace.refreshFeature("optimization", true);
    await workspace.reconnect();
    expect(workspace.can("optimization")).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { denied.mockRestore(); }
});

test("storage denial retires pending owner evidence even after readable storage recovers", async () => {
  const workspace = useWorkspaceStore();
  localStorage.setItem("accessToken", "fixture-owner-a");
  await workspace.refreshCore(true);
  const held = deferredRead();
  let signal;
  global.fetch.mockImplementationOnce((_url, options) => { signal = options.signal; return held.promise; });
  const pending = workspace.refreshFeature("optimization", true);
  const denied = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Fixture storage denied"); });
  try {
    expect(() => workspace.can("optimization")).not.toThrow();
    expect(workspace.can("optimization")).toBe(false);
    expect(signal.aborted).toBe(true);
  } finally {
    denied.mockRestore();
    held.resolve(reply({ ...healthyOptimization, reason: "Obsolete owner evidence" }));
    await pending;
  }
  expect(workspace.optimization).toBeNull();
  expect(workspace.can("optimization")).toBe(false);
  localStorage.setItem("accessToken", "fixture-owner-b");
  global.fetch.mockImplementation(async url => reply(healthy[url]));
  await workspace.refreshCore(true);
  expect(workspace.can("optimization")).toBe(true);
  expect(global.fetch.mock.calls.at(-1)[1].headers.Authorization).toBe("Bearer fixture-owner-b");
});
