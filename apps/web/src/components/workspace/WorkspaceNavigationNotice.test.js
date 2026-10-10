import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { setLocale } from "@/i18n";
import WorkspaceNavigationNotice from "./WorkspaceNavigationNotice.vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";

const mockWorkspace = reactive({ navigationFailure: null });
const mockRoute = reactive({ fullPath: "/buyables", matched: [{}] });
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRoute: () => mockRoute, useRouter: () => mockRouter }));
jest.mock("./BrandMark.vue", () => ({ template: '<img alt="" />' }));
jest.mock("./LanguageMenu.vue", () => ({ template: '<button type="button">Language</button>' }));
const wrappers = [];
const setup = standalone => {
  const wrapper = mount(WorkspaceNavigationNotice, { props: { standalone }, global: { stubs: {
    BrandMark: true, LanguageMenu: true,
    VBtn: { props: ["disabled", "loading", "ariaLabel"], template: '<button :disabled="disabled" :aria-label="ariaLabel"><slot /></button>' },
    VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  } } });
  wrappers.push(wrapper); return wrapper;
};
beforeEach(() => {
  mockRoute.fullPath = "/buyables"; mockRoute.matched = [{}];
  mockWorkspace.navigationFailure = { from: "/buyables", target: "/references" };
  mockRouter.push.mockReset().mockResolvedValue(undefined);
  mockRouter.replace.mockReset().mockResolvedValue(undefined);
});
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test.each(["en", "zh-CN"])("recovery copy has the shared %s authority and never includes the chemical URL", locale => {
  setLocale(locale, { persist: false });
  const wrapper = setup(false);
  expect(wrapper.get('[role="alert"]').text()).toContain(locale === "en"
    ? "Could not open this page. Check the connection and retry." : "暂时无法打开页面，请检查连接后重试。");
  expect(wrapper.text()).not.toContain("/references");
});

test("explicit retry is single-flight and does not erase failure before navigation actually commits", async () => {
  let finish; mockRouter.push.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const wrapper = setup(false), retry = wrapper.get('[data-cy="workspace-navigation-retry"]');
  await retry.trigger("click"); await retry.trigger("click");
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith("/references");
  expect(retry.element.disabled).toBe(true);
  expect(mockWorkspace.navigationFailure).not.toBeNull();
  finish({ type: 4 }); await flushPromises();
  expect(retry.element.disabled).toBe(false);
});

test("initial-entry recovery replaces the pending URL and cannot be dismissed into a blank page", async () => {
  mockRoute.matched = [];
  const wrapper = setup(true);
  expect(wrapper.find("h1").exists()).toBe(true);
  expect(wrapper.findAll('[data-cy="workspace-navigation-retry"]')).toHaveLength(1);
  expect(wrapper.find('button[aria-label="关闭提示"]').exists()).toBe(false);
  await wrapper.get('[data-cy="workspace-navigation-retry"]').trigger("click");
  expect(mockRouter.replace).toHaveBeenCalledWith("/references");
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test("a notice for a retired page is absent and a disconnected old retry cannot start new work", async () => {
  const wrapper = setup(false);
  mockRoute.fullPath = "/process"; await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  wrapper.unmount(); expect(mockRouter.push).not.toHaveBeenCalled();
});

test("the application root supplies a public recovery state only before any route has mounted", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "../../App.vue"), "utf8"));
  expect(descriptor.template.content).toContain('v-app v-if="entryFailure"');
  expect(descriptor.template.content).toContain('<router-view v-else');
  expect(descriptor.scriptSetup.content).toContain('route.matched?.length === 0 && !!workspace.navigationFailure');
});
