import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import TaskDetail from "./TaskDetail.vue";

jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/components/routes/RouteReader.vue", () => ({
  name: "RouteReader", props: ["candidates", "busy", "loading", "selectedRoute", "view", "canEdit"],
  template: '<div class="reader">{{ candidates.length }}</div>',
}));
jest.mock("@/components/workspace/TaskInfoDialog.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/TaskSearchProgress.vue", () => ({ template: "<div />" }));

const wrappers = [];
const idA = "a".repeat(32), idB = "b".repeat(32), snapshot = "c".repeat(64);
const routeValue = { route_id: "route-a", target_smiles: "CCO", steps: [] };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup(patch = {}) {
  const route = reactive({ params: { id: idA }, query: {} });
  const state = { job: { job_id: idA, status: "searching", result_snapshot: snapshot }, routes: [routeValue], failArtifact: false, ...patch };
  const router = { push: jest.fn().mockResolvedValue(undefined) };
  useRoute.mockReturnValue(route);
  useRouter.mockReturnValue(router);
  API.get.mockImplementation(async (url) => {
    if (!url.includes("retrieve")) return { ...state.job, job_id: route.params.id };
    if (state.failArtifact) throw new Error("artifact unavailable");
    return { result: { unified_route_pool: { selected_routes: state.routes } } };
  });
  API.post.mockResolvedValue({});
  const wrapper = mount(TaskDetail, { global: { stubs: {
    VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled"><slot /></button>' },
    VIcon: true, VProgressCircular: true,
  } } });
  wrappers.push(wrapper);
  await settle();
  return { route, state, router, wrapper };
}

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  jest.clearAllTimers(); jest.useRealTimers();
});

test("poll ticks update lifecycle without downloading or replacing an unchanged route artifact", async () => {
  const { wrapper, state } = await setup();
  const candidates = wrapper.vm.candidates;
  state.job.progress = { pass_number: 2 };
  await jest.advanceTimersByTimeAsync(15000);
  await settle();
  expect(API.get.mock.calls.filter(([url]) => url.includes("retrieve"))).toHaveLength(1);
  expect(wrapper.vm.candidates).toBe(candidates);
  expect(wrapper.vm.job.progress.pass_number).toBe(2);
  await wrapper.vm.refresh(true);
  expect(API.get.mock.calls.filter(([url]) => url.includes("retrieve"))).toHaveLength(2);
});

test("artifact failure on a terminal update leaves the last good routes and a visible error", async () => {
  const { wrapper, state } = await setup();
  state.job.status = "completed";
  state.job.result_snapshot = "d".repeat(64);
  state.failArtifact = true;
  await jest.advanceTimersByTimeAsync(5000);
  await settle();
  expect(wrapper.find(".reader").text()).toBe("1");
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(wrapper.vm.job.status).toBe("completed");
  expect(wrapper.vm.taskInfo.num_trees).toBeNull();
  expect(wrapper.findComponent({ name: "RouteReader" }).props("canEdit")).toBe(false);
  await wrapper.vm.edit("route-a");
  expect(API.post).not.toHaveBeenCalled();
  state.failArtifact = false;
  state.routes = [];
  await wrapper.vm.refresh(true);
  await settle();
  expect(wrapper.vm.candidates).toEqual([]);
  expect(wrapper.find(".reader").exists()).toBe(false);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.vm.taskInfo.num_trees).toBe(0);
});

test("an initial artifact failure does not manufacture a zero-route success count", async () => {
  const { wrapper } = await setup({ failArtifact: true });
  expect(wrapper.vm.taskInfo.num_trees).toBeNull();
  expect(wrapper.vm.error).toBeTruthy();
  expect(wrapper.find(".reader").exists()).toBe(false);
});

test("from-task copies bind the exact route ID and index without changing the existing request fields", async () => {
  const { wrapper, router } = await setup();
  API.post.mockResolvedValueOnce({ id: "d".repeat(32) });
  await wrapper.vm.edit("route-a");
  expect(API.post).toHaveBeenCalledWith("/api/v1/route-documents/from-task", { job_id: idA, route_index: 0, route_id: "route-a" });
  expect(router.push).toHaveBeenCalledWith("/editor/" + "d".repeat(32));
});

test("a from-task failure blocks stale copy retries until an actual artifact refresh, not just another status tick", async () => {
  const { wrapper, state } = await setup();
  API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "Selected route changed" })));
  await wrapper.vm.edit("route-a");
  expect(wrapper.vm.copyError).toBeTruthy();
  expect(wrapper.findComponent({ name: "RouteReader" }).props("canEdit")).toBe(false);
  await wrapper.vm.edit("route-a");
  await wrapper.vm.refresh();
  await wrapper.vm.edit("route-a");
  expect(API.post).toHaveBeenCalledTimes(1);
  state.job.result_snapshot = "d".repeat(64);
  state.routes = [{ ...routeValue, route_id: "route-b" }];
  await wrapper.vm.refresh(true);
  expect(wrapper.vm.copyError).toBe("");
  expect(wrapper.findComponent({ name: "RouteReader" }).props("canEdit")).toBe(true);
  API.post.mockResolvedValueOnce({ id: "e".repeat(32) });
  await wrapper.vm.edit("route-b");
  expect(API.post).toHaveBeenLastCalledWith("/api/v1/route-documents/from-task", { job_id: idA, route_index: 0, route_id: "route-b" });
});

test("changing task aborts old reads and still loads the new task while the old read is pending", async () => {
  const { wrapper, route } = await setup();
  const old = deferred();
  API.get.mockImplementationOnce(() => old.promise);
  const pending = wrapper.vm.refresh(true);
  const signal = API.get.mock.calls.at(-1)[3].signal;
  route.params.id = idB;
  await settle();
  expect(signal.aborted).toBe(true);
  expect(wrapper.vm.job.job_id).toBe(idB);
  expect(wrapper.vm.loading).toBe(false);
  old.resolve({ job_id: idA, status: "failed" });
  await pending;
  expect(wrapper.vm.job.job_id).toBe(idB);
});

test.each(["resolve", "reject"])("a late rerun %s cannot affect another task, even after A to B to A navigation", async (outcome) => {
  const { wrapper, route, router } = await setup();
  const old = deferred();
  API.get.mockImplementationOnce(() => old.promise);
  const pending = wrapper.vm.rerun();
  const signal = API.get.mock.calls.at(-1)[3].signal;
  route.params.id = idB;
  await settle();
  route.params.id = idA;
  await settle();
  expect(signal.aborted).toBe(true);
  old[outcome](outcome === "resolve" ? { settings: { smiles: "CCO" } } : new Error("old task failed"));
  await pending;
  expect(router.push).not.toHaveBeenCalled();
  expect(wrapper.vm.actionError).toBe("");
  expect(wrapper.vm.rerunning).toBe(false);
});

test("duplicate rerun is blocked without blocking a separate resume mutation or invalidating it on refresh", async () => {
  const { wrapper, router } = await setup();
  const request = deferred();
  API.get.mockImplementationOnce(() => request.promise);
  const rerun = wrapper.vm.rerun();
  const reads = API.get.mock.calls.length;
  await wrapper.vm.rerun();
  expect(API.get).toHaveBeenCalledTimes(reads);
  await wrapper.vm.changeTask("resume");
  expect(API.post).toHaveBeenCalledWith(`/api/v1/unified-route/jobs/${idA}/resume`);
  expect(wrapper.vm.rerunning).toBe(true);
  request.resolve({ settings: { smiles: "CCO", description: "Original task", expansion_time: 1800, strategies: ["mcts", "retro_star"] } });
  await rerun;
  expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ path: "/", query: expect.objectContaining({ smiles: "CCO" }) }));
  expect(JSON.parse(router.push.mock.calls[0][0].query.search_settings)).toMatchObject({ expansion_time: 1800, strategies: ["mcts", "retro_star"] });
  expect(wrapper.vm.rerunning).toBe(false);
  expect(wrapper.vm.mutating).toBe(false);
});

test("unmount aborts pending rerun, ignores its response and disposes polling", async () => {
  const { wrapper, router } = await setup();
  const request = deferred();
  API.get.mockImplementationOnce(() => request.promise);
  const pending = wrapper.vm.rerun();
  const signal = API.get.mock.calls.at(-1)[3].signal;
  wrapper.unmount();
  wrappers.splice(wrappers.indexOf(wrapper), 1);
  expect(signal.aborted).toBe(true);
  request.resolve({ settings: { smiles: "CCO" } });
  await pending;
  const calls = API.get.mock.calls.length;
  await jest.advanceTimersByTimeAsync(10000);
  expect(API.get).toHaveBeenCalledTimes(calls);
  expect(router.push).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("a same-tick task detour invalidates rerun even when the final task ID is unchanged", async () => {
  const { wrapper, route, router } = await setup();
  const request = deferred();
  API.get.mockImplementationOnce(() => request.promise);
  const pending = wrapper.vm.rerun();
  const signal = API.get.mock.calls.at(-1)[3].signal;
  route.params.id = idB;
  route.params.id = idA;
  expect(signal.aborted).toBe(true);
  request.resolve({ settings: { smiles: "CCO" } });
  await pending;
  await settle();
  expect(router.push).not.toHaveBeenCalled();
});

test.each(["edit", "resume"])("late %s responses cannot release a newer mutation after a task detour", async (action) => {
  const { wrapper, route, router } = await setup();
  const old = deferred(), current = deferred();
  API.post.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
  const run = () => action === "edit" ? wrapper.vm.edit("route-a") : wrapper.vm.changeTask("resume");
  const pending = run();
  route.params.id = idB;
  route.params.id = idA;
  await settle();
  const next = run();
  const flag = action === "edit" ? "editing" : "mutating";
  expect(wrapper.vm[flag]).toBe(true);
  old.resolve({ id: "d".repeat(32) });
  await pending;
  expect(wrapper.vm[flag]).toBe(true);
  expect(router.push).not.toHaveBeenCalled();
  current.resolve({ id: "e".repeat(32) });
  await next;
  expect(wrapper.vm[flag]).toBe(false);
  expect(wrapper.vm.actionError).toBe("");
});
