import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, onMounted, onUnmounted, reactive, ref } from "vue";
import { randomUUID } from "node:crypto";
import { API } from "@/common/api";
import Banlist from "./Banlist.vue";

let mockWorkspace;
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), delete: jest.fn() } }));
jest.mock("vuetify-use-dialog", () => ({ useConfirm: () => jest.fn() }));
jest.mock("@/components/SmilesImage", () => ({ template: '<div />' }));
jest.mock("@/components/CopyTooltip", () => ({ template: '<slot />' }));
jest.mock("@/components/banlist/BanItemDialog", () => ({ name: "BanItemDialog", template: '<NativeDraft />' }));
jest.mock("@/components/banlist/MultiEntryDialog", () => ({ template: '<div />' }));

let mounts, unmounts;
const wrappers = [], hosts = [];
const NativeDraft = defineComponent({ setup() {
  const text = ref("");
  onMounted(() => mounts++);
  onUnmounted(() => unmounts++);
  return () => h("input", { "aria-label": "native rule draft", value: text.value,
    onInput: (event) => { text.value = event.target.value; } });
} });
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/banlist", component: Banlist, meta: { feature: "native_account" } }] });
  await router.push("/banlist");
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const wrapper = mount(Banlist, { attachTo: host, global: {
    plugins: [router], components: { NativeDraft }, stubs: {
      RouterLink: { template: '<a><slot /></a>' }, VDefaultsProvider: { props: ["defaults"], template: '<slot />' }, VIcon: true, VProgressLinear: true,
      VSelect: true, VSwitch: true, VDataTable: true, VBtn: { template: '<button><slot /></button>' },
      VTooltip: { inheritAttrs: false, template: '<slot name="activator" :props="{}" />' },
    },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
  mounts = 0;
  unmounts = 0;
  API.get.mockReset().mockResolvedValue([]);
  API.delete.mockReset();
  mockWorkspace = reactive({ allowed: true, loading: false, refreshed: 1, error: "",
    can: () => mockWorkspace.allowed, checking: () => false, refresh: jest.fn() });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test("background refresh cannot remount native rule input; capability loss hides and recovery retains it", async () => {
  const wrapper = await setup();
  const input = wrapper.get('input[aria-label="native rule draft"]');
  await input.setValue("[13CH3]CO.[Cl-]");
  mockWorkspace.loading = true;
  await flushPromises();
  expect(wrapper.get('input[aria-label="native rule draft"]').element).toBe(input.element);
  mockWorkspace.allowed = false;
  await flushPromises();
  expect(input.element.isConnected).toBe(true);
  expect(wrapper.get(".workbench-content").isVisible()).toBe(false);
  expect(unmounts).toBe(0);
  mockWorkspace.allowed = true;
  await flushPromises();
  expect(wrapper.get('input[aria-label="native rule draft"]').element).toBe(input.element);
  expect(input.element.value).toContain("[Cl-]");
  expect(mounts).toBe(1);
  expect(API.delete).not.toHaveBeenCalled();
});
test("native rule tabs name and relabel the shared table panel without changing the input instance", async () => {
  const wrapper = await setup();
  const input = wrapper.get('input[aria-label="native rule draft"]').element;
  const tabs = wrapper.findAll('[role="tab"]');
  expect(wrapper.get('[role="tablist"]').attributes("aria-label")).toBe("禁用规则模块");
  tabs[0].element.focus();
  await tabs[0].trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(tabs[1].attributes("aria-selected")).toBe("true");
  const panel = wrapper.get('[role="tabpanel"]');
  expect(panel.attributes("id")).toBe(tabs[1].attributes("aria-controls"));
  expect(panel.attributes("aria-labelledby")).toBe(tabs[1].attributes("id"));
  expect(wrapper.get('input[aria-label="native rule draft"]').element).toBe(input);
});
test("unavailable native account never mounts guarded content or fetches rule collections", async () => {
  mockWorkspace.allowed = false;
  const wrapper = await setup();
  expect(wrapper.find("input").exists()).toBe(false);
  expect(mounts).toBe(0);
  expect(API.get).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});
