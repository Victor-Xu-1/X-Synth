import { createPinia, setActivePinia } from "pinia";
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
