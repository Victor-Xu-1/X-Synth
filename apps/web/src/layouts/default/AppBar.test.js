import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import AppBar from "./AppBar.vue";

jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/components/workspace/BrandMark.vue", () => ({
  props: ["size"],
  template: '<img class="x-synth-brand-mark" alt="" :width="size" />',
}));
const mockRoute = reactive({ path: "/", query: {}, meta: { title: "路线设计" } });
const mockWorkspace = reactive({ ready: false, loading: false, local: true, error: "", coreChecking: false,
  checking: () => mockWorkspace.coreChecking, features: {} });
let wrapper;
const stubs = {
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VBtn: {
    props: ["to", "icon"],
    emits: ["click"],
    template: '<button :data-to="to" :data-icon="icon" @click="$emit(\'click\')" />',
  },
  VIcon: { template: '<span aria-hidden="true" />' },
};
beforeEach(() => {
  Object.assign(mockRoute, { path: "/", query: {}, meta: { title: "路线设计" } });
  Object.assign(mockWorkspace, { ready: false, loading: false, local: true, error: "", coreChecking: false, features: {} });
  wrapper = mount(AppBar, { global: { stubs } });
});
afterEach(() => wrapper.unmount());

test("the full-width header owns the supplied brand and authoritative version", () => {
  const brand = wrapper.get('a[href="/"]');
  expect(brand.text()).toContain("X-Synth");
  expect(brand.text()).toContain(`v${__X_SYNTH_VERSION__}`);
  expect(brand.attributes("aria-label")).toContain("X-Synth");
  expect(brand.find("img").exists()).toBe(true);
  expect(wrapper.find("h1").exists()).toBe(false);
  expect(wrapper.find("input").exists()).toBe(false);
});

test.each([
  ["/results/123", "任务与路线"],
  ["/editor/123", "任务与路线"],
  ["/environments", "环境部署"],
])("%s uses its existing navigation family as quiet location context", async (path, title) => {
  mockRoute.path = path;
  mockRoute.meta = { title: "页面详情" };
  await nextTick();
  expect(wrapper.get(".workspace-location-current").text()).toBe(title);
  expect(wrapper.text()).not.toContain("页面详情");
});

test("an unavailable tool does not manufacture an available navigation family", async () => {
  mockRoute.path = "/buyables";
  mockRoute.meta = { title: "原料检索" };
  await nextTick();
  expect(wrapper.get(".workspace-location-current").text()).toBe("原料检索");
  mockWorkspace.features = { stock: true };
  await nextTick();
  expect(wrapper.get(".workspace-location-current").text()).toBe("原料检索");
});

test("service readiness, loading and offline states remain distinct", async () => {
  expect(wrapper.get('[role="status"]').text()).toBe("服务未就绪");
  mockWorkspace.loading = true;
  mockWorkspace.coreChecking = true;
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("连接中");
  mockWorkspace.ready = true;
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("搜索就绪");
  await wrapper.setProps({ online: false });
  expect(wrapper.get('[role="status"]').text()).toBe("网络离线");
  expect(wrapper.get('[role="status"]').classes()).not.toContain("ready");
  expect(wrapper.get('[aria-label="环境部署"]').attributes("data-to")).toBe("/environments");
});

test("a known core failure is not disguised as connecting while an optional refresh continues", async () => {
  mockWorkspace.loading = true; mockWorkspace.error = "无法连接工作区服务";
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("服务未就绪");
});

test("a confirmed not-ready core is not connecting while unrelated optional work is still loading", async () => {
  mockWorkspace.loading = true; mockWorkspace.coreChecking = false;
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("服务未就绪");
});

test("navigation toggle exposes drawer state without adding a navigation implementation", async () => {
  await wrapper.setProps({ mobile: true, navigationOpen: true });
  const toggle = wrapper.get('[aria-label="切换导航"]');
  expect(toggle.attributes("aria-controls")).toBe("workspace-navigation");
  expect(toggle.attributes("aria-expanded")).toBe("true");
  expect(toggle.attributes("data-icon")).toBe("mdi-close");
  await toggle.trigger("click");
  expect(wrapper.emitted("toggle-navigation")).toEqual([[]]);
});

test("existing header links close a mobile drawer without replacing their destinations", async () => {
  await wrapper.get('a[href="/"]').trigger("click");
  await wrapper.get('[aria-label="环境部署"]').trigger("click");
  expect(wrapper.emitted("navigate")).toEqual([[], []]);
});
