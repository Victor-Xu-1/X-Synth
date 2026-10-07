import { defineComponent, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { expandMolecule } from "@/common/one-step";
import { useWorkspaceStore } from "@/store/workspace";
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
const wrappers = [];
function setup(query = {}) {
  setActivePinia(createPinia());
  const route = reactive({ query });
  const router = { push: jest.fn(), replace: jest.fn() };
  useRoute.mockReturnValue(route);
  useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ ready: true, can: () => true });
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
  };
  wrappers.push(wrapper);
  return { ...state, route, router, wrapper };
}
beforeEach(() => jest.clearAllMocks());
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
