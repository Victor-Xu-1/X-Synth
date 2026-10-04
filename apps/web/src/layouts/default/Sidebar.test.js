import { mount } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import Sidebar from "./Sidebar.vue";

jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/composables/useTheme", () => ({ useTheme: () => ({ isDark: mockDark, toggleTheme: mockToggleTheme }) }));
jest.mock("@/components/workspace/BrandMark.vue", () => ({ template: '<img alt="" />' }));
const mockRoute = reactive({ path: "/", query: {} });
const mockWorkspace = reactive({ features: {}, local: true, refreshed: 1 });
const mockDark = ref(false);
const mockToggleTheme = jest.fn();
let wrapper;
const stubs = {
  RouterLink: {
    props: ["to"],
    emits: ["click"],
    template: '<a :href="typeof to === \'string\' ? to : to.path" @click="$emit(\'click\')"><slot /></a>',
  },
  VIcon: { props: ["icon"], template: '<span :data-icon="icon" aria-hidden="true" />' },
  VBtn: { emits: ["click"], template: '<button @click="$emit(\'click\')" />' },
};
beforeEach(() => {
  Object.assign(mockWorkspace, { features: {}, local: true, refreshed: 1 });
  Object.assign(mockRoute, { path: "/", query: {} });
  mockDark.value = false;
  mockToggleTheme.mockClear();
  wrapper = mount(Sidebar, { global: { stubs } });
});
afterEach(() => wrapper.unmount());

test("module icons, Chinese labels and capability-filtered hrefs retain one navigation authority", async () => {
  const links = () => wrapper.findAll(".workspace-nav .nav-item");
  expect(links().map((link) => link.text())).toEqual(["路线设计", "任务与路线"]);
  expect(wrapper.get('a[href="/results"]').attributes("aria-label")).toBe("任务与路线");
  mockWorkspace.features = { stock: true, fast_filter: true, drawing: true, process: true, optimization: true };
  await nextTick();
  expect(links().map((link) => link.text())).toEqual(["路线设计", "任务与路线", "原料检索", "反应与条件", "结构工具", "工艺核算", "实验优化"]);
  for (const link of links()) expect(link.find("[data-icon]").exists()).toBe(true);
  expect(wrapper.get('.workspace-sidebar-footer a[href="/environments"]').exists()).toBe(true);
  expect(wrapper.find('a[href="/login"]').exists()).toBe(false);
});

test("current module remains selected for task detail and closes mobile navigation on click", async () => {
  mockRoute.path = "/results/123";
  await nextTick();
  expect(wrapper.findAll('a[aria-current="page"]')).toHaveLength(1);
  const selected = wrapper.get('a[aria-current="page"]');
  expect(selected.attributes("href")).toBe("/results");
  await selected.trigger("click");
  expect(wrapper.emitted("navigate")).toEqual([[]]);
});

test("compact controls retain accessible theme labels and authenticated account link", async () => {
  await wrapper.setProps({ compact: true });
  const theme = wrapper.get('button[aria-label="切换主题"]');
  expect(theme.attributes("title")).toBe("切换主题");
  await theme.trigger("click");
  expect(mockToggleTheme).toHaveBeenCalledTimes(1);
  mockWorkspace.local = false;
  await nextTick();
  expect(wrapper.get('a[href="/login"]').attributes("aria-label")).toBe("账户");
  expect(wrapper.get('a[href="/results"]').attributes("title")).toBe("任务与路线");
  mockDark.value = true;
  await nextTick();
  expect(theme.get("[data-icon]").attributes("data-icon")).toBe("mdi-weather-sunny");
});

test("the drawer offers a labeled close command while keeping the existing brand link", async () => {
  expect(wrapper.get(".workspace-brand").attributes("href")).toBe("/");
  await wrapper.get('button[aria-label="关闭导航"]').trigger("click");
  expect(wrapper.emitted("navigate")).toEqual([[]]);
});
