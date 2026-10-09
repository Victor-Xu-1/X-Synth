import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import EnvironmentDeployment from "./EnvironmentDeployment.vue";

jest.mock("@vueuse/core", () => ({ useOnline: () => mockOnline }));
jest.mock("vue-router", () => ({
  useRoute: () => mockRoute, useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock("@/common/api", () => ({ API: {} }));
jest.mock("@/common/runtime-status", () => ({ loadRuntimeStatus: (...args) => mockLoad(...args) }));
const mockOnline = ref(true);
const mockRoute = reactive({ query: { tab: "monitor" } });
const mockLoad = jest.fn();
let wrapper;
const unavailable = { unavailable: ["environments", "templates"] };
const ready = { unavailable: [], environments: { platform: {}, engines: [] } };
const stubs = {
  VBtn: { props: ["loading"], template: '<button :disabled="loading"><slot /></button>' },
  VTabs: { template: '<div><slot /></div>' },
  VTab: { template: '<button><slot /></button>' },
  VIcon: { template: '<span />' },
  EngineEnvironment: true, BackendInventory: true,
  EnvironmentMonitoring: { template: '<div data-cy="monitor">Current environment</div>' },
};
function setup() { wrapper = mount(EnvironmentDeployment, { global: { stubs } }); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function connection(value) { mockOnline.value = value; await nextTick(); }
beforeEach(() => { mockOnline.value = true; mockLoad.mockReset(); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });

test("reconnection refreshes the failed page automatically without changing its URL tab", async () => {
  mockLoad.mockResolvedValueOnce(ready).mockResolvedValueOnce(unavailable).mockResolvedValueOnce(ready);
  setup(); await flushPromises();
  await connection(false);
  await wrapper.get("header button").trigger("click"); await flushPromises();
  expect(wrapper.text()).toContain("环境信息暂不可用");
  await connection(true); await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(3);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find('[data-cy="monitor"]').exists()).toBe(true);
  expect(mockRoute.query.tab).toBe("monitor");
});

test("reconnect during an in-flight read schedules only one following read", async () => {
  const pending = deferred();
  mockLoad.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ready);
  setup();
  await connection(false); await connection(true);
  await connection(false); await connection(true);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  pending.resolve(unavailable); await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(wrapper.find('[data-cy="monitor"]').exists()).toBe(true);
});

test("a pending reconnect cannot send another request after a subsequent disconnect", async () => {
  const pending = deferred(); mockLoad.mockReturnValue(pending.promise);
  setup(); await connection(false); await connection(true); await connection(false);
  pending.resolve(unavailable); await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("环境信息暂不可用");
});

test("leaving the page releases reconnect work and ignores late responses", async () => {
  const pending = deferred(); mockLoad.mockReturnValue(pending.promise);
  setup(); await connection(false); await connection(true);
  wrapper.unmount(); wrapper = undefined;
  pending.resolve(unavailable); await flushPromises();
  await connection(false); await connection(true); await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

test("a provider failure remains visible and does not create an endless retry loop", async () => {
  mockLoad.mockResolvedValue(unavailable);
  setup(); await flushPromises(); await connection(false); await connection(true); await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(2);
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  await flushPromises();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});
