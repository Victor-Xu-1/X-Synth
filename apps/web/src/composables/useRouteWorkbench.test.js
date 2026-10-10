import { defineComponent, nextTick, reactive, ref, watch } from "vue";
import { deserialize, serialize } from "node:v8";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { expandMolecule } from "@/common/one-step";
import { useWorkspaceStore } from "@/store/workspace";
import { useRouteWorkbenchStore } from "@/store/route-workbench";
import { buildTaskSearchLocation } from "@/common/task-history-view";
import { defaultSearchSettings } from "@/common/workbench-model";
import { useRouteWorkbench } from "./useRouteWorkbench";

jest.mock("vue-router", () => ({
  useRoute: jest.fn(),
  useRouter: jest.fn(),
  onBeforeRouteLeave: jest.fn(),
}));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/common/one-step", () => ({ expandMolecule: jest.fn() }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
globalThis.structuredClone = (value) => deserialize(serialize(value));
const wrappers = [];
function setup(query = {}, pinia = createPinia()) {
  setActivePinia(pinia);
  const route = reactive({ path: "/", query });
  const router = { push: jest.fn(), replace: jest.fn() };
  useRoute.mockReturnValue(route);
  useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue(reactive({ ready: true, retroReady: true, can() { return this.retroReady; } }));
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useRouteWorkbench();
        return () => null;
      },
    }),
  );
  state.structure.value = {
    read: jest.fn().mockResolvedValue("CCO"),
    capture: jest.fn(),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  wrappers.push(wrapper);
  return { ...state, route, router, wrapper, pinia };
}
beforeEach(() => {
  window.history.replaceState({}, "");
  jest.clearAllMocks();
  API.post.mockReset();
  expandMolecule.mockReset();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const settings = {
  smiles: "CCO",
  description: "Replay",
  backend: "askcos",
  public: false,
  strategies: ["retro_star"],
  expansion_time: 127,
  max_paths: 80,
  min_routes: 4,
  max_routes: 8,
  repair_attempts: 0,
  tuning: {
    max_depth: 15,
    max_branching: 40,
    template_count: 800,
    cumulative_probability: 0.001,
    minimum_plausibility: 0,
  },
};
const seed = () => buildTaskSearchLocation({ settings }).query;

test("typed history prefill does not execute validation, search or one-step models", () => {
  const state = setup(seed());
  expect(state.draft.settings).toMatchObject({
    strategies: ["retro_star"],
    maxPaths: 80,
    minRoutes: 4,
    repairAttempts: 0,
    minutes: 127 / 60,
  });
  expect(API.post).not.toHaveBeenCalled();
  expect(expandMolecule).not.toHaveBeenCalled();
});
test("structure readiness does not relabel a healthy model as unavailable", async () => {
  const state = setup(seed());
  expect(state.ready.value).toBe(true);
  state.structure.value = { pending: true, read: jest.fn() };
  expect(state.canSubmit.value).toBe(false);
  await state.submit();
  expect(state.structure.value.read).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
  expect(state.ready.value).toBe(true);
  state.structure.value.pending = false;
  expect(state.canSubmit.value).toBe(true);
});
test("an empty board or an unmounted structure cannot start an inference", async () => {
  const state = setup(seed());
  state.draft.smiles = "";
  expect(state.canSubmit.value).toBe(false);
  await state.submit();
  expect(API.post).not.toHaveBeenCalled();
  state.draft.smiles = "CCO";
  state.structure.value = null;
  expect(state.canSubmit.value).toBe(false);
  await state.submit();
  expect(API.post).not.toHaveBeenCalled();
});
test("explicit submit sends the same validated policy and second-level budget as the stored request", async () => {
  const state = setup(seed());
  API.post
    .mockResolvedValueOnce({ smiles: "CCO" })
    .mockResolvedValueOnce({ job_id: "a".repeat(32) });
  await state.submit();
  expect(API.post.mock.calls[0]).toEqual([
    "/api/v1/structure/validate",
    { smiles: "CCO" },
  ]);
  expect(API.post.mock.calls[1]).toEqual([
    "/api/v1/unified-route/call-async",
    settings,
  ]);
  expect(state.router.push).toHaveBeenCalledWith("/results/" + "a".repeat(32));
});
test.each([
  { strategies: ["unknown"] },
  { max_paths: 501 },
  { min_routes: 8, max_routes: 3 },
  { repair_attempts: 2 },
  { expansion_time: 59 },
  { expansion_time: true },
])(
  "malformed prefills cannot fall through into an automatically defaulted submission",
  async (invalid) => {
    const state = setup({ search_settings: JSON.stringify(invalid) });
    await state.submit();
    expect(state.error.value).not.toBe("");
    expect(API.post).not.toHaveBeenCalled();
    expect(state.router.push).not.toHaveBeenCalled();
  },
);
test("a structure-only handoff and a fresh URL clear hidden replay policy", async () => {
  const state = setup(seed());
  state.route.query = { smiles: "O" };
  await nextTick();
  expect(state.draft.settings).toEqual(defaultSearchSettings());
  expect(state.draft.smiles).toBe("O");
  state.draft.settings.minRoutes = 8;
  state.route.query = {};
  await nextTick();
  expect(state.draft.settings).toEqual(defaultSearchSettings());
  expect(API.post).not.toHaveBeenCalled();
});
test("mode-only switches preserve current edits rather than reseeding the replay", async () => {
  const state = setup(seed());
  state.draft.settings.minutes = 7;
  state.route.query = { ...seed(), mode: "manual" };
  await nextTick();
  expect(state.draft.settings.minutes).toBe(7);
  expect(expandMolecule).not.toHaveBeenCalled();
});

test.each([{}, seed()])("returning to the same input context retains the entire session draft", query => {
  const first = setup(query);
  first.draft.smiles = "CCN"; first.draft.name = "Unsubmitted name / %";
  first.draft.settings.minutes = 7.5; first.draft.settings.maxRoutes = 7;
  first.draft.settings.tuning.max_depth = 14;
  const expected = { ...first.draft.settings, strategies: [...first.draft.settings.strategies], tuning: { ...first.draft.settings.tuning } };
  first.wrapper.unmount();
  const returned = setup(query, first.pinia);
  expect(returned.draft.smiles).toBe("CCN"); expect(returned.draft.name).toBe("Unsubmitted name / %");
  expect(returned.draft.settings).toEqual(expected);
  expect(API.post).not.toHaveBeenCalled(); expect(expandMolecule).not.toHaveBeenCalled();
});

test("returning with a genuinely new seed replaces only through the validated seed transaction", () => {
  const first = setup(seed()); first.draft.settings.minutes = 7.5;
  first.wrapper.unmount();
  const returned = setup({ smiles: "CCN", task_name: "New target" }, first.pinia);
  expect(returned.draft.smiles).toBe("CCN"); expect(returned.draft.name).toBe("New target");
  expect(returned.draft.settings).toEqual(defaultSearchSettings());
});

test("an outgoing composer cannot consume another page's query as a fresh input context", async () => {
  const first = setup(seed()); first.draft.settings.minutes = 7.5; first.draft.settings.maxRoutes = 7;
  first.route.path = "/results"; first.route.query = { status: "completed" }; await nextTick();
  expect(first.draft.settings.minutes).toBe(7.5); expect(first.draft.settings.maxRoutes).toBe(7);
  first.wrapper.unmount();
  const returned = setup(seed(), first.pinia); expect(returned.draft.settings.minutes).toBe(7.5);
});

test("an explicit new rerun intent replaces the seed, while Back to the same intent retains edits", () => {
  window.history.replaceState({ xSynthSearchIntent: "first" }, "");
  const first = setup(seed()); first.draft.settings.minutes = 7.5; first.wrapper.unmount();
  const same = setup(seed(), first.pinia); expect(same.draft.settings.minutes).toBe(7.5); same.wrapper.unmount();
  window.history.replaceState({ xSynthSearchIntent: "second" }, "");
  const next = setup(seed(), first.pinia); expect(next.draft.settings.minutes).toBe(settings.expansion_time / 60);
  expect(API.post).not.toHaveBeenCalled();
});
test("a new URL seed invalidates pending structure reads without submitting the old task", async () => {
  const state = setup(seed());
  let resolve;
  state.structure.value.read.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const pending = state.submit();
  state.route.query = { smiles: "O" };
  await nextTick();
  resolve("CCO");
  await pending;
  expect(API.post).not.toHaveBeenCalled();
  expect(state.busy.value).toBe(false);
});
test("invalid manually edited draft fields cannot reach the job API", async () => {
  const state = setup();
  state.draft.smiles = "CCO";
  state.draft.settings.minRoutes = 8;
  state.draft.settings.maxRoutes = 3;
  await state.submit();
  expect(API.post).not.toHaveBeenCalled();
  expect(state.error.value).not.toBe("");
});
test("returning to an earlier valid prefill clears a failed seed without auto-submitting", async () => {
  const state = setup(seed());
  state.route.query = { search_settings: JSON.stringify({ max_paths: 501 }) };
  await nextTick();
  expect(state.error.value).not.toBe("");
  state.route.query = seed();
  await nextTick();
  expect(state.error.value).toBe("");
  expect(state.draft.smiles).toBe(settings.smiles);
  expect(API.post).not.toHaveBeenCalled();
  expect(expandMolecule).not.toHaveBeenCalled();
  API.post
    .mockResolvedValueOnce({ smiles: "CCO" })
    .mockResolvedValueOnce({ job_id: "a".repeat(32) });
  await state.submit();
  expect(API.post.mock.calls[1]).toEqual([
    "/api/v1/unified-route/call-async",
    settings,
  ]);
});

// Protocol fixtures exercise session ownership, not chemical or native-model acceptance.
const manualResult = () => ({
  canonical: "CCO",
  model: "pistachio",
  outcomes: [{ outcome: "C.CO", plausibility: 0.8 }],
});
function manualSetup() {
  return setup({ mode: "manual", smiles: "CCO" });
}
const manualEdits = [
  ["target", (draft) => { draft.smiles = "CCN"; draft.smiles = "CCO"; }],
  ["model", (draft) => { draft.manual.model = "pistachio_ringbreaker"; draft.manual.model = "pistachio"; }],
  ["template count", (draft) => { draft.manual.count = 800; draft.manual.count = 1000; }],
  ["filter threshold", (draft) => { draft.manual.threshold = 0.5; draft.manual.threshold = 0.75; }],
];
test.each(manualEdits)("a published pool cannot be reused after same-tick %s edits and revert", async (_label, edit) => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  expect(state.draft.manualResult).not.toBeNull();
  state.preview(0);
  expect(state.previewOpen.value).toBe(true);
  edit(state.draft);
  expect(state.draft.manualResult).toBeNull();
  expect(state.previewOpen.value).toBe(false);
  expect(state.previewCandidates.value).toEqual([]);
  state.preview(0);
  await state.editCandidate(0);
  expect(API.post).not.toHaveBeenCalled();
  expect(state.router.push).not.toHaveBeenCalled();
  expect(state.error.value).not.toBe("");
});
test.each(manualEdits)("late manual success cannot publish after same-tick %s edits and revert", async (_label, edit) => {
  const state = manualSetup();
  let finish;
  expandMolecule.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = state.submit();
  await flushPromises();
  edit(state.draft);
  finish(manualResult());
  await pending;
  expect(state.draft.manualResult).toBeNull();
  expect(state.busy.value).toBe(false);
  expect(state.error.value).toBe("");
});
test("late manual failure cannot replace the current input state", async () => {
  const state = manualSetup();
  let fail;
  expandMolecule.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  const pending = state.submit();
  await flushPromises();
  manualEdits[0][1](state.draft);
  fail(new Error("obsolete request failed"));
  await pending;
  expect(state.error.value).toBe("");
  expect(state.busy.value).toBe(false);
});
test("manual settings are captured before an asynchronous board read", async () => {
  const state = manualSetup();
  let read;
  state.structure.value.read.mockReturnValue(new Promise((resolve) => { read = resolve; }));
  const pending = state.submit();
  manualEdits[2][1](state.draft);
  read("CCO");
  await pending;
  expect(expandMolecule).not.toHaveBeenCalled();
  expect(state.draft.manualResult).toBeNull();
});
test("the owned native read can normalize text without invalidating its manual request", async () => {
  const state = manualSetup();
  state.draft.smiles = "OCC";
  state.structure.value.read.mockImplementation(async () => {
    state.structureSmiles.value = "CCO";
    return "CCO";
  });
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  expect(state.draft.smiles).toBe("CCO");
  expect(expandMolecule).toHaveBeenCalledTimes(1);
  expect(expandMolecule).toHaveBeenCalledWith(API, expect.objectContaining({ smiles: "CCO" }));
  expect(state.draft.manualResult).not.toBeNull();
  expect(state.error.value).toBe("");
  expect(state.busy.value).toBe(false);
  expect(state.readingStructure.value).toBe(false);
});
test.each(manualEdits)("a late native read cannot publish its normalization after %s edits and revert", async (_label, edit) => {
  const state = manualSetup();
  let finish;
  state.structure.value.read.mockImplementation(() => new Promise((resolve) => {
    finish = () => { state.structureSmiles.value = "OCC"; resolve("OCC"); };
  }));
  const pending = state.submit();
  edit(state.draft);
  finish(); await pending;
  expect(state.draft.smiles).toBe("CCO");
  expect(expandMolecule).not.toHaveBeenCalled();
  expect(state.draft.manualResult).toBeNull();
  expect(state.readingStructure.value).toBe(false);
});
test("a newer URL cannot start an overlapping read or be overwritten by an older normalized read", async () => {
  const state = manualSetup();
  let finish;
  state.structure.value.read.mockImplementation(() => new Promise((resolve) => {
    finish = () => { state.structureSmiles.value = "OCC"; resolve("OCC"); };
  }));
  const pending = state.submit();
  state.route.query = { mode: "manual", smiles: "CCN" };
  expect(state.canSubmit.value).toBe(false);
  await state.submit();
  expect(state.structure.value.read).toHaveBeenCalledTimes(1);
  finish(); await pending;
  expect(state.draft.smiles).toBe("CCN");
  expect(expandMolecule).not.toHaveBeenCalled();
  expect(state.busy.value).toBe(false);
});
test("an unmounted native read cannot apply its late text normalization to the session", async () => {
  const state = manualSetup();
  let finish;
  state.structure.value.read.mockImplementation(() => new Promise((resolve) => {
    finish = () => { state.structureSmiles.value = "OCC"; resolve("OCC"); };
  }));
  const pending = state.submit();
  state.wrapper.unmount();
  finish(); await pending;
  expect(useRouteWorkbenchStore().smiles).toBe("CCO");
  expect(useRouteWorkbenchStore().manualResult).toBeNull();
  expect(expandMolecule).not.toHaveBeenCalled();
});
test("manual readiness gates only new inference and retains a current candidate pool", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.workspace.retroReady = false;
  expect(state.ready.value).toBe(false);
  expect(state.canSubmit.value).toBe(false);
  expect(state.canCompareManual.value).toBe(true);
  await state.submit();
  expect(expandMolecule).toHaveBeenCalledTimes(1);
  expect(state.draft.manualResult).not.toBeNull();
});

test("an owned normalization inside a reactive publication does not expire its request", () => {
  const state = manualSetup(), driver = ref(0);
  const request = state.draft.beginManualRequest();
  const stop = watch(driver, () => state.draft.applyManualRead(request, "OCC"), { flush: "sync" });
  driver.value++;
  stop();
  expect(state.draft.smiles).toBe("OCC");
  expect(state.draft.manualRevision).toBe(request.revision);
  state.draft.smiles = "CCN"; state.draft.smiles = "OCC";
  expect(state.draft.manualRevision).toBeGreaterThan(request.revision);
});
test("clear removes the target, candidate pool and preview without running a model", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.preview(0);
  await state.clearStructure();
  expect(state.structure.value.clear).toHaveBeenCalledTimes(1);
  expect(state.draft.smiles).toBe("");
  expect(state.draft.manualResult).toBeNull();
  expect(state.previewOpen.value).toBe(false);
  expect(state.canSubmit.value).toBe(false);
  expect(expandMolecule).toHaveBeenCalledTimes(1);
});
test("a current clear failure stays explicit and preserves the input and candidate pool", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.structure.value.clear.mockRejectedValue(new Error('{"detail":"Board clear failed"}'));
  await state.clearStructure();
  expect(state.draft.smiles).toBe("CCO");
  expect(state.draft.manualResult).not.toBeNull();
  expect(state.error.value).toContain("Board clear failed");
});
test("a late clear cannot erase a newer target", async () => {
  const state = manualSetup();
  let finish;
  state.structure.value.clear.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = state.clearStructure();
  state.draft.smiles = "CCN";
  finish(); await pending;
  expect(state.draft.smiles).toBe("CCN");
});
test("same-tick target edits and revert during a board read cannot start a stale request", async () => {
  const state = manualSetup();
  let read;
  state.structure.value.read.mockReturnValue(new Promise((resolve) => { read = resolve; }));
  const pending = state.submit();
  manualEdits[0][1](state.draft);
  read("CCO");
  await pending;
  expect(expandMolecule).not.toHaveBeenCalled();
  expect(state.draft.manualResult).toBeNull();
  expect(state.busy.value).toBe(false);
});
test("pending drawing/file input gates old candidate actions before SMILES publication", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.preview(0);
  state.structure.value.pending = true;
  await nextTick();
  expect(state.previewOpen.value).toBe(false);
  state.preview(0);
  await state.editCandidate(0);
  expect(API.post).not.toHaveBeenCalled();
});
test("a pending edit reverted to the same exported text does not restore old candidates", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.structure.value.pending = true;
  state.structure.value.pending = false;
  expect(state.draft.smiles).toBe("CCO");
  expect(state.draft.manualResult).toBeNull();
});
test("session freshness continues while the composer is unmounted", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.wrapper.unmount();
  const draft = useRouteWorkbenchStore();
  manualEdits[0][1](draft);
  expect(draft.manualResult).toBeNull();
});
test("same-tick manual mode changes and revert invalidate a pending response", async () => {
  const state = manualSetup();
  let finish;
  expandMolecule.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = state.submit();
  await flushPromises();
  state.route.query = { ...state.route.query, mode: "auto" };
  state.route.query = { ...state.route.query, mode: "manual" };
  finish(manualResult());
  await pending;
  expect(state.draft.manualResult).toBeNull();
});
test("a superseded request cannot publish or release a newer request's busy state", async () => {
  const state = manualSetup();
  let first, second;
  expandMolecule
    .mockReturnValueOnce(new Promise((resolve) => { first = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { second = resolve; }));
  const older = state.submit();
  await flushPromises();
  state.route.query = { ...state.route.query, mode: "auto" };
  state.route.query = { ...state.route.query, mode: "manual" };
  const newer = state.submit();
  await flushPromises();
  first(manualResult());
  await older;
  expect(state.draft.manualResult).toBeNull();
  expect(state.busy.value).toBe(true);
  const result = { ...manualResult(), outcomes: [] };
  second(result); await newer;
  expect(state.draft.manualResult.outcomes).toEqual([]);
  expect(state.busy.value).toBe(false);
});
test("a manual response after unmount cannot enter the shared session", async () => {
  const state = manualSetup();
  let finish;
  expandMolecule.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = state.submit();
  await flushPromises();
  state.wrapper.unmount();
  finish(manualResult()); await pending;
  expect(useRouteWorkbenchStore().manualResult).toBeNull();
});
test("a current manual error stays explicit and a new request clears the previous pool", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValueOnce(manualResult());
  await state.submit();
  state.preview(0);
  expandMolecule.mockRejectedValueOnce(new Error('{"detail":"Native service unavailable"}'));
  await state.submit();
  expect(state.draft.manualResult).toBeNull();
  expect(state.previewOpen.value).toBe(false);
  expect(state.error.value).toContain("Native service unavailable");
});
test("an invalid link cannot leave a cached candidate-action gate or preview enabled", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  expect(state.canCompareManual.value).toBe(true);
  state.preview(0);
  state.route.query = { ...state.route.query, search_settings: JSON.stringify({ max_paths: 501 }) };
  await nextTick();
  expect(state.canCompareManual.value).toBe(false);
  expect(state.previewOpen.value).toBe(false);
  expect(state.previewCandidates.value).toEqual([]);
  await state.editCandidate(0);
  expect(API.post).not.toHaveBeenCalled();
});
test("current candidate editing remains an unclosed draft through the existing document API", async () => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  state.preview(0);
  expect(state.previewCandidates.value[0].closed).toBe(false);
  API.post.mockResolvedValue({ id: "manual-draft" });
  await state.editCandidate(0);
  expect(API.post).toHaveBeenCalledWith("/api/v1/route-documents", expect.objectContaining({
    title: "一步候选 1", graph: expect.any(Object),
  }));
  const body = API.post.mock.calls[0][1];
  expect(body).not.toHaveProperty("provenance");
  expect(body).not.toHaveProperty("closed");
  expect(state.router.push).toHaveBeenCalledWith("/editor/manual-draft");
});
test.each(["success", "failure"])("a late document %s after input edits cannot open or relabel the old candidate", async (outcome) => {
  const state = manualSetup();
  expandMolecule.mockResolvedValue(manualResult());
  await state.submit();
  let finish, fail;
  API.post.mockReturnValue(new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const pending = state.editCandidate(0);
  manualEdits[0][1](state.draft);
  if (outcome === "success") finish({ id: "previous-draft" });
  else fail(new Error('{"detail":"previous document failed"}'));
  await pending;
  expect(state.router.push).not.toHaveBeenCalled();
  expect(state.error.value).toBe("");
  expect(state.busy.value).toBe(false);
});
test("manual request settings and server-normalized target remain distinct from auto search settings", async () => {
  const state = manualSetup();
  const input = "[Na+].[13CH3][C@H](O)C(=O)[O-]";
  state.draft.smiles = input;
  state.structure.value.read.mockResolvedValue(input);
  state.draft.manual = { model: "pistachio_ringbreaker", count: 750, threshold: 0.6 };
  state.draft.settings.minutes = 7;
  const result = { ...manualResult(), canonical: "[13CH3][C@H](O)C(=O)[O-].[Na+]", model: "pistachio_ringbreaker" };
  expandMolecule.mockResolvedValue(result);
  await state.submit();
  expect(expandMolecule).toHaveBeenCalledWith(API, { smiles: input, model: "pistachio_ringbreaker", count: 750, threshold: 0.6 });
  expect(state.draft.manualContext).toEqual({ model: "pistachio_ringbreaker", count: 750, threshold: 0.6 });
  state.preview(0);
  expect(state.previewCandidates.value[0].target_smiles).toBe(result.canonical);
  expect(state.draft.settings.minutes).toBe(7);
  expect(API.post).not.toHaveBeenCalled();
});
