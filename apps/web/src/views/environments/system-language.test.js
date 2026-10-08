import { mount, flushPromises } from "@vue/test-utils";
import BackendInventory from "@/components/environments/BackendInventory.vue";
import EngineEnvironment from "@/components/environments/EngineEnvironment.vue";
import EnvironmentMonitoring from "@/components/environments/EnvironmentMonitoring.vue";
import { initializeLocale, setLocale } from "@/i18n";

const stubs = { VIcon: true, VBtn: { template: "<button><slot /></button>" } };

test("English disabled inventory labels switch without translating unknown backend identity or enabling capability", async () => {
  initializeLocale(null);
  const inventory = { native: { modules: [
    { id: "custom-backend", label: "工艺核算", configured: false, status: "preserved_disabled", source_present: true },
  ] }, integrations: [{ id: "llm", status: "not_integrated", runtime_verified: false }],
  dependencies: { native_models: { status: "unavailable" } }, operations: { call_async: { supported: false } } };
  const before = JSON.stringify(inventory);
  const wrapper = mount(BackendInventory, { props: { inventory }, global: { stubs } });
  expect(wrapper.text()).toContain("Source preserved; disabled");
  expect(wrapper.text()).toContain("Not configured; direct submission is not allowed");
  expect(wrapper.text()).toContain("工艺核算");
  expect(wrapper.text()).not.toContain("Process accounting");
  const table = wrapper.get("table").element;
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("源码保留，未启用");
  expect(wrapper.get("table").element).toBe(table);
  expect(JSON.stringify(inventory)).toBe(before);
  wrapper.unmount();
});

test("long English engine state and known strategy text leave actual model identifiers and raw strategy IDs intact", async () => {
  initializeLocale(null);
  const engine = { name: "ASKCOS fixture identity", status: "degraded", active: false, models_verified: false,
    runtime_mode: "supervised_native", available_strategies: ["mcts", "private-strategy"],
    configured_models: ["USPTO_STEREO"], unrecognized_model_count: 3 };
  const before = JSON.stringify(engine);
  const wrapper = mount(EngineEnvironment, { props: { engine }, global: { stubs } });
  expect(wrapper.text()).toContain("Partially ready");
  expect(wrapper.text()).toContain("3 model configurations unrecognized");
  expect(wrapper.text()).toContain("Tree search · MCTS / private-strategy");
  expect(wrapper.text()).toContain("USPTO_STEREO");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("3 项模型配置未识别");
  expect(JSON.stringify(engine)).toBe(before);
  expect(wrapper.emitted("configure")).toBeUndefined();
  wrapper.unmount();
});

test("monitoring titles and pending process statuses react while raw resources remain unchanged", async () => {
  initializeLocale(null);
  const snapshot = { runtime: { resources: { services: { gateway: { status: "stopped", rss_bytes: 1048576 } } }, budget: { active_jobs: 0 } } };
  const before = JSON.stringify(snapshot);
  const wrapper = mount(EnvironmentMonitoring, { props: { snapshot }, global: { stubs } });
  expect(wrapper.text()).toContain("Engine gateway");
  expect(wrapper.text()).toContain("Stopped");
  expect(wrapper.text()).toContain("Not ready");
  expect(wrapper.text()).toContain("1.0 MiB");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain("引擎网关");
  expect(wrapper.text()).toContain("已停止");
  expect(JSON.stringify(snapshot)).toBe(before);
  wrapper.unmount();
});
