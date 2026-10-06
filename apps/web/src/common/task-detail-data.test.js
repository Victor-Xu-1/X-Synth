import { createTaskDetailLoader } from "./task-detail-data";

const snapshot = "a".repeat(64);
const route = { route_id: "route-a", target_smiles: "CCO", steps: [] };
const artifact = (routes = [route]) => ({ result: { unified_route_pool: { selected_routes: routes } } });

function setup(job = { status: "searching", result_snapshot: snapshot }) {
  const state = { job, artifact: artifact(), failure: null };
  const api = { get: jest.fn(async (url) => {
    if (!url.includes("retrieve")) return state.job;
    if (state.failure) throw state.failure;
    return state.artifact;
  }) };
  return { state, api, loader: createTaskDetailLoader(api), reads: () => api.get.mock.calls.filter(([url]) => url.includes("retrieve")) };
}

test("artifact failure does not hide fresh lifecycle status or engine recovery reason", async () => {
  const response = {
    status: "waiting_for_engine",
    error_code: "engine_unavailable",
  };
  const result = await createTaskDetailLoader(
    {
      get: async (url) => {
        if (url.includes("retrieve"))
          throw new Error("route_artifact_unavailable");
        return response;
      },
    },
  ).load("task-id", { force: true });
  expect(result.job).toBe(response);
  expect(result.candidates).toEqual([]);
  expect(result.error).toBeTruthy();
});

test("invalid route records stay errors while task status remains available", async () => {
  const result = await createTaskDetailLoader(
    {
      get: async (url) =>
        url.includes("retrieve")
          ? { result: { unified_route_pool: { selected_routes: [{}] } } }
          : { status: "completed" },
    },
  ).load("task-id", { force: true });
  expect(result.job.status).toBe("completed");
  expect(result.candidates).toEqual([]);
  expect(result.error).toBe("路线记录无效。");
});

test("an immutable snapshot is loaded once despite status, pass, count and worker progress changes", async () => {
  const { state, loader, reads } = setup();
  const first = await loader.load("task-a");
  expect(first.artifactCurrent).toBe(true);
  expect(first.artifactRefreshed).toBe(true);
  state.job = { ...state.job, status: "completed", revision: 42, progress: { pass_number: 2, native_progress: { iterations: 900 } }, summary: { selected_route_count: 3 } };
  const next = await loader.load("task-a");
  expect(reads()).toHaveLength(1);
  expect(next.job.status).toBe("completed");
  expect(next.candidates).toBe(first.candidates);
  expect(next.artifactCurrent).toBe(true);
  expect(next.artifactRefreshed).toBe(false);
  state.job.result_snapshot = "b".repeat(64);
  await loader.load("task-a");
  expect(reads()).toHaveLength(2);
});

test.each(["status", "pass", "count"])("legacy artifact cache invalidates on relevant %s changes only", async (change) => {
  const { state, loader, reads } = setup({ status: "searching", result_snapshot: null, progress: { pass_number: 1 }, summary: { selected_route_count: 0 } });
  await loader.load("legacy-a");
  state.job.revision = 2;
  state.job.progress.native_progress = { mcts: { iterations: 100 } };
  await loader.load("legacy-a");
  expect(reads()).toHaveLength(1);
  if (change === "status") state.job.status = "evaluating";
  if (change === "pass") state.job.progress.pass_number = 2;
  if (change === "count") state.job.summary.selected_route_count = 1;
  await loader.load("legacy-a");
  expect(reads()).toHaveLength(2);
});

test("schema-1 tasks wait for publication without requesting a missing artifact", async () => {
  const { state, loader, reads } = setup({ status: "queued", result_snapshot: null, progress: { result_artifact_schema: 1 } });
  expect((await loader.load("new-a")).candidates).toEqual([]);
  state.job.status = "searching";
  await loader.load("new-a");
  expect(reads()).toHaveLength(0);
  state.job.result_snapshot = snapshot;
  state.job.progress.published_result = { schema_version: 1, snapshot_id: snapshot };
  expect((await loader.load("new-a")).candidates).toEqual([route]);
  expect(reads()).toHaveLength(1);
});

test("legacy records with a null snapshot still retrieve their preserved route shape", async () => {
  const { loader, reads } = setup({ status: "legacy_completed", result_snapshot: null, progress: { result_artifact_schema: 1 } });
  expect((await loader.load("legacy-a")).candidates).toEqual([route]);
  expect(reads()).toHaveLength(1);
});

test("missing publication metadata cannot silently erase routes already displayed", async () => {
  const { state, loader } = setup();
  const first = await loader.load("task-a");
  state.job.result_snapshot = null;
  state.job.progress = { result_artifact_schema: 1 };
  const result = await loader.load("task-a");
  expect(result.candidates).toBe(first.candidates);
  expect(result.error).toBeTruthy();
});

test("an unknown snapshot in a schema-1 response is an error, not an empty result", async () => {
  const { state, loader, reads } = setup();
  const first = await loader.load("task-a");
  delete state.job.result_snapshot;
  state.job.progress = { result_artifact_schema: 1 };
  const result = await loader.load("task-a");
  expect(result.candidates).toBe(first.candidates);
  expect(result.error).toBeTruthy();
  expect(reads()).toHaveLength(1);
});

test("manual refresh refetches an unchanged snapshot and successful empty results replace routes", async () => {
  const { state, loader, reads } = setup();
  await loader.load("task-a");
  state.artifact = artifact([]);
  expect((await loader.load("task-a", { force: true })).candidates).toEqual([]);
  expect(reads()).toHaveLength(2);
  await loader.load("task-a");
  expect(reads()).toHaveLength(2);
});

test.each(["fetch", "decode"])("a %s failure retains the last good routes and remains visible until recovery", async (kind) => {
  const { state, loader } = setup();
  const first = await loader.load("task-a");
  state.job = { ...state.job, status: "completed", result_snapshot: "b".repeat(64) };
  if (kind === "fetch") state.failure = new Error("artifact unavailable");
  else state.artifact = artifact([{}]);
  const failed = await loader.load("task-a");
  expect(failed.candidates).toBe(first.candidates);
  expect(failed.artifactCurrent).toBe(false);
  expect(failed.job.status).toBe("completed");
  expect(failed.error).toBeTruthy();
  state.failure = null;
  state.artifact = artifact([]);
  const recovered = await loader.load("task-a");
  expect(recovered.candidates).toEqual([]);
  expect(recovered.error).toBe("");
  expect(recovered.artifactCurrent).toBe(true);
  expect(recovered.artifactRefreshed).toBe(true);
});

test.each(["not-a-sha256", "", "g".repeat(64), "a".repeat(63), 42, {}, [], [snapshot]])("invalid snapshot metadata cannot replace the last successful artifact: %p", async (invalid) => {
  const { state, loader, reads } = setup();
  const first = await loader.load("task-a");
  state.job.result_snapshot = invalid;
  const result = await loader.load("task-a");
  expect(result.candidates).toBe(first.candidates);
  expect(result.error).toBeTruthy();
  expect(reads()).toHaveLength(1);
});

test.each([409, 503])("a failed new publication read (%s) retains last good routes without advancing the cache identity", async (status) => {
  const { state, loader, reads } = setup();
  const first = await loader.load("task-a");
  state.job = { ...state.job, status: "completed", result_snapshot: "b".repeat(64), progress: { result_artifact_schema: 1, published_result: { schema_version: 1, snapshot_id: "b".repeat(64) } } };
  state.failure = new Error(JSON.stringify({ detail: `Published snapshot unavailable (${status})` }));
  const failed = await loader.load("task-a");
  expect(failed.candidates).toBe(first.candidates);
  expect(failed.error).toContain(String(status));
  state.failure = null;
  state.artifact = artifact([{ ...route, route_id: "route-b" }]);
  const recovered = await loader.load("task-a");
  expect(recovered.candidates[0].route_id).toBe("route-b");
  expect(recovered.error).toBe("");
  await loader.load("task-a");
  expect(reads()).toHaveLength(3);
});

test("a publication switch during artifact retrieval cannot cache new routes under an old snapshot", async () => {
  const { state, api, loader, reads } = setup();
  const first = await loader.load("task-a");
  const ordinaryRead = api.get.getMockImplementation();
  state.job.result_snapshot = "b".repeat(64);
  api.get.mockImplementation(async (url) => {
    if (!url.includes("retrieve")) return state.job;
    state.job = { ...state.job, result_snapshot: "c".repeat(64) };
    return artifact([{ ...route, route_id: "route-c" }]);
  });
  const changed = await loader.load("task-a");
  expect(changed.candidates).toBe(first.candidates);
  expect(changed.job.result_snapshot).toBe("c".repeat(64));
  expect(changed.error).toBeTruthy();
  api.get.mockImplementation(ordinaryRead);
  state.artifact = artifact([{ ...route, route_id: "route-c" }]);
  const confirmed = await loader.load("task-a");
  expect(confirmed.candidates[0].route_id).toBe("route-c");
  expect(confirmed.error).toBe("");
  await loader.load("task-a");
  expect(reads()).toHaveLength(3);
});

test.each([null, "OK", {}, { result: {} }, artifact(null)])("a malformed published response cannot be treated as valid empty routes: %p", async (invalid) => {
  const { state, loader } = setup();
  const first = await loader.load("task-a");
  state.job.result_snapshot = "b".repeat(64);
  state.artifact = invalid;
  const result = await loader.load("task-a");
  expect(result.candidates).toBe(first.candidates);
  expect(result.error).toBeTruthy();
});

test("a status failure does not hide an independently available initial artifact", async () => {
  const api = { get: jest.fn(async (url) => {
    if (!url.includes("retrieve")) throw new Error("status unavailable");
    return artifact();
  }) };
  const result = await createTaskDetailLoader(api).load("legacy-a");
  expect(result.job).toBeUndefined();
  expect(result.candidates).toEqual([route]);
  expect(result.error).toBeTruthy();
});

test("reset and a different task invalidate late results without leaking cached routes", async () => {
  const { state, api, loader } = setup();
  await loader.load("task-a");
  let resolve;
  api.get.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
  const previous = loader.load("task-a", { force: true });
  loader.reset();
  state.failure = new Error("task b artifact failed");
  expect((await loader.load("task-b")).candidates).toEqual([]);
  resolve({ status: "completed", result_snapshot: snapshot });
  expect(await previous).toBeNull();
});
