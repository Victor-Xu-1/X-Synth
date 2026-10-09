import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { setLocale } from "@/i18n";
import WorkspaceSectionNav from "./WorkspaceSectionNav.vue";

jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@vueuse/core", () => ({
  useResizeObserver: (target, callback) => { mockResize = callback; },
}));
const mockRoute = reactive({ path: "/impurity", query: {} });
const mockWorkspace = reactive({ features: {} });
let mockResize, wrapper, viewportWidth, activeWidth, itemPositions;
const stubs = {
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
  VIcon: { template: '<span aria-hidden="true" />' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VBtn: { template: '<button><slot /></button>' },
  VList: { template: '<div><slot /></div>' },
  VListItem: { template: '<a />' },
};
async function settle() { await nextTick(); await nextTick(); }
function geometry() {
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function () {
      const nav = this.closest(".workspace-section-nav");
      const left = this === nav ? 100 : 100 + (itemPositions[this.getAttribute("href")] || 700) - nav.scrollLeft;
      const width = this === nav ? viewportWidth : activeWidth;
      return { left, right: left + width, top: 80, bottom: 130, width, height: 50 };
    });
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewportWidth);
  jest.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => 1100);
}
beforeEach(() => {
  viewportWidth = 375; activeWidth = 152; itemPositions = { "/impurity": 761 };
  mockResize = undefined;
  Object.assign(mockRoute, { path: "/impurity", query: {} });
  mockWorkspace.features = { references: true, fast_filter: true, templates: true, conditions: true, forward: true, impurity: true };
  setLocale("en", { persist: false });
  geometry();
  wrapper = mount(WorkspaceSectionNav, { attachTo: document.body, global: { stubs } });
});
afterEach(() => { wrapper?.unmount(); jest.restoreAllMocks(); });

test("direct entry reveals the current tool without scrolling the page", async () => {
  await settle();
  const nav = wrapper.get("nav").element;
  const active = wrapper.get('[aria-current="page"]').element;
  expect(nav.scrollLeft).toBeGreaterThan(0);
  expect(active.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
  expect(document.documentElement.scrollTop).toBe(0);
  expect(document.activeElement).toBe(document.body);
});

test("back and query-tab navigation reveal the new current item", async () => {
  await settle();
  const nav = wrapper.get("nav").element;
  itemPositions["/forward?tab=context"] = 420;
  mockRoute.path = "/forward"; mockRoute.query = { tab: "context" };
  await settle();
  expect(wrapper.get('[aria-current="page"]').attributes("href")).toBe("/forward?tab=context");
  expect(nav.scrollLeft).toBeLessThan(761 - 375 + 152);
  itemPositions["/forward?tab=forward"] = 720;
  mockRoute.query = { tab: "forward" };
  await settle();
  expect(wrapper.get('[aria-current="page"]').element.getBoundingClientRect().right).toBeLessThanOrEqual(475);
});

test("locale and container resize reveal translated labels without changing the route", async () => {
  await settle();
  itemPositions["/impurity"] = 485; activeWidth = 90;
  setLocale("zh-CN", { persist: false });
  await settle();
  expect(wrapper.get('[aria-current="page"]').text()).toBe("杂质预测");
  expect(mockRoute.path).toBe("/impurity");
  const nav = wrapper.get("nav").element;
  nav.scrollLeft = 0; viewportWidth = 320;
  mockResize(); await settle();
  expect(wrapper.get('[aria-current="page"]').element.getBoundingClientRect().right).toBeLessThanOrEqual(420);
});

test("background readiness refresh preserves deliberate horizontal exploration", async () => {
  await settle();
  const nav = wrapper.get("nav").element;
  nav.scrollLeft = 0;
  mockWorkspace.features = { ...mockWorkspace.features };
  mockRoute.query = { unrelated: "reading" };
  await settle();
  expect(nav.scrollLeft).toBe(0);
});

test("hidden and released navigation cannot retain delayed scroll work", async () => {
  await settle();
  const nav = wrapper.get("nav").element;
  nav.scrollLeft = 0; viewportWidth = 0;
  mockResize(); await settle();
  expect(nav.scrollLeft).toBe(0);
  wrapper.unmount(); wrapper = undefined;
  viewportWidth = 375;
  mockResize(); await settle();
  expect(nav.scrollLeft).toBe(0);
});
