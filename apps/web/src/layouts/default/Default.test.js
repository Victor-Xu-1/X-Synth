import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import DefaultLayout from "./Default.vue";

jest.mock("@vueuse/core", () => ({
  useWindowSize: () => ({ width: mockWidth }),
  useOnline: () => mockOnline,
}));
jest.mock("@/store/workspace", () => ({
  useWorkspaceStore: () => mockWorkspace,
}));
jest.mock("@/composables/useTheme", () => ({
  useTheme: () => ({ isDark: false, toggleTheme: jest.fn() }),
}));
jest.mock("vue-router", () => ({
  useRoute: () => ({ path: "/", query: {}, meta: {} }),
}));
jest.mock("@/components/workspace/BrandMark.vue", () => ({
  template: '<img alt="" />',
}));
const mockWidth = ref(1440);
const mockOnline = ref(true);
const mockWorkspace = { refresh: jest.fn(), reconnect: jest.fn(), features: {} };
let wrapper;
const stubs = {
  VApp: { template: "<div><slot /></div>" },
  AppBar: {
    props: ["navigationOpen", "mobile", "online"],
    emits: ["toggle-navigation", "navigate"],
    template:
      '<header class="workspace-header"><button class="workspace-navigation-toggle" :aria-expanded="navigationOpen" @click="$emit(\'toggle-navigation\')" /><a href="/" @click="$emit(\'navigate\')">X-Synth</a></header>',
  },
  Sidebar: {
    props: ["compact"],
    emits: ["navigate"],
    template:
      '<aside class="workspace-sidebar"><a href="/">首页</a><button @click="$emit(\'navigate\')">关闭导航</button></aside>',
  },
  WorkspaceSectionNav: { template: "<nav />" },
  WorkspaceUpdateNotice: { template: "<div />" },
  RouterView: { template: '<button class="page-action">Page</button>' },
};
beforeEach(() => {
  jest.useFakeTimers();
  mockWorkspace.refresh.mockClear();
  mockWorkspace.reconnect.mockClear();
  mockWidth.value = 1440;
  mockOnline.value = true;
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  jest.useRealTimers();
});
function setup(width = 1440) {
  mockWidth.value = width;
  wrapper = mount(DefaultLayout, {
    attachTo: document.body,
    global: { stubs },
  });
  return wrapper;
}

test("header spans the shell rather than living inside the page column", () => {
  setup();
  expect(wrapper.get(".workspace-header").element.parentElement).toBe(
    wrapper.get(".workspace-shell").element,
  );
  expect(wrapper.get(".workspace-main").find("header").exists()).toBe(false);
  expect(wrapper.findAll("main")).toHaveLength(1);
});

test("module navigation remains outside the primary content scroller", () => {
  setup();
  const navigation = wrapper.findComponent(stubs.WorkspaceSectionNav).element;
  const content = wrapper.get("#workspace-content").element;
  expect(navigation.parentElement === wrapper.get(".workspace-main").element).toBe(true);
  expect(content.contains(navigation)).toBe(false);
  expect(navigation.nextElementSibling === content).toBe(true);
});

test("desktop starts with readable labeled navigation and can compact it", async () => {
  setup(1024);
  expect(wrapper.findComponent(stubs.Sidebar).props("compact")).toBe(false);
  await wrapper.get(".workspace-navigation-toggle").trigger("click");
  expect(wrapper.findComponent(stubs.Sidebar).props("compact")).toBe(true);
});

test("skip navigation focuses the primary work area", async () => {
  setup();
  await wrapper.get(".skip-navigation").trigger("click");
  expect(document.activeElement).toBe(wrapper.get("#workspace-content").element);
  expect(wrapper.get("#workspace-content").attributes("tabindex")).toBe("-1");
});

test("closed mobile drawer is excluded from focus and accessibility trees", () => {
  setup(390);
  const aside = wrapper.get("aside");
  expect(aside.attributes("inert")).toBeDefined();
  expect(aside.attributes("aria-hidden")).toBe("true");
  expect(wrapper.find(".navigation-scrim").exists()).toBe(false);
});

test("mobile drawer traps focus, closes on Escape and returns focus to its toggle", async () => {
  setup(390);
  const toggle = wrapper.get(".workspace-navigation-toggle");
  await toggle.trigger("click");
  await nextTick();
  const aside = wrapper.get("aside");
  expect(aside.attributes("inert")).toBeUndefined();
  expect(aside.attributes("role")).toBe("dialog");
  expect(aside.attributes("aria-modal")).toBe("true");
  expect(wrapper.get(".workspace-main").attributes("inert")).toBeDefined();
  expect(wrapper.get("header").attributes("inert")).toBeDefined();
  expect(wrapper.get(".skip-navigation").attributes("inert")).toBeDefined();
  expect(wrapper.get(".navigation-scrim").attributes("tabindex")).toBe("-1");
  expect(wrapper.get(".navigation-scrim").attributes("aria-hidden")).toBe("true");
  const first = aside.get("a").element;
  const last = aside.get("button").element;
  const lastFocus = jest.spyOn(last, "focus");
  expect(document.activeElement).toBe(first);
  await aside.trigger("keydown", { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  expect(lastFocus).toHaveBeenLastCalledWith();
  await aside.trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(first);
  await aside.trigger("keydown", { key: "Escape" });
  await nextTick();
  expect(aside.attributes("aria-hidden")).toBe("true");
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle.element);
  expect(wrapper.get("header").attributes("inert")).toBeUndefined();
  lastFocus.mockRestore();
});

test("a focus attempt outside the open drawer stays within its controls", async () => {
  setup(390);
  await wrapper.get(".workspace-navigation-toggle").trigger("click");
  const first = wrapper.get("aside a").element;
  wrapper.get(".page-action").element.focus();
  expect(document.activeElement).toBe(first);
});

test("queued close focus cannot steal focus from a subsequently reopened drawer", async () => {
  setup(390);
  const toggle = wrapper.get(".workspace-navigation-toggle").element;
  toggle.click();
  await nextTick();
  wrapper.get("aside button").element.click();
  toggle.click();
  await nextTick();
  await nextTick();
  expect(wrapper.get("aside").attributes("aria-modal")).toBe("true");
  expect(document.activeElement).toBe(wrapper.get("aside a").element);
});

test("an immediately closed or unmounted drawer cannot publish late opening focus", async () => {
  setup(390);
  const toggle = wrapper.get(".workspace-navigation-toggle").element;
  toggle.click();
  toggle.click();
  await nextTick();
  await nextTick();
  expect(document.activeElement).toBe(toggle);
  toggle.click();
  wrapper.unmount(); wrapper = undefined;
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere); elsewhere.focus();
  await nextTick();
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test.each([".navigation-scrim", "aside button"])(
  "%s closes the drawer without losing focus",
  async (selector) => {
    setup(390);
    await wrapper.get(".workspace-navigation-toggle").trigger("click");
    await wrapper.get(selector).trigger("click");
    await nextTick();
    expect(wrapper.get("aside").attributes("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(
      wrapper.get(".workspace-navigation-toggle").element,
    );
  },
);

test("header navigation closes the modal drawer rather than leaving the destination inert", async () => {
  setup(390);
  await wrapper.get(".workspace-navigation-toggle").trigger("click");
  await wrapper.get("header a").trigger("click");
  expect(wrapper.get("aside").attributes("aria-hidden")).toBe("true");
  expect(wrapper.get(".workspace-main").attributes("inert")).toBeUndefined();
});

test("crossing the breakpoint closes the drawer and keeps subsequent mobile navigation inert", async () => {
  setup(390);
  await wrapper.get(".workspace-navigation-toggle").trigger("click");
  mockWidth.value = 1024;
  await nextTick();
  expect(wrapper.find(".navigation-scrim").exists()).toBe(false);
  expect(wrapper.get("aside").attributes("inert")).toBeUndefined();
  mockWidth.value = 390;
  await nextTick();
  expect(wrapper.get("aside").attributes("inert")).toBeDefined();
});

test("offline message and readiness polling are preserved and the interval is cleaned up", async () => {
  setup();
  expect(mockWorkspace.refresh).toHaveBeenCalledWith(true);
  jest.advanceTimersByTime(15000);
  expect(mockWorkspace.refresh).toHaveBeenCalledTimes(2);
  mockOnline.value = false;
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("网络已断开");
  expect(wrapper.findComponent(stubs.AppBar).props("online")).toBe(false);
  wrapper.unmount();
  wrapper = undefined;
  jest.advanceTimersByTime(15000);
  expect(mockWorkspace.refresh).toHaveBeenCalledTimes(2);
});

test("coming online rechecks readiness immediately and unmounted layouts cannot request another reconnect", async () => {
  setup();
  mockOnline.value = false; await nextTick();
  expect(mockWorkspace.reconnect).not.toHaveBeenCalled();
  mockOnline.value = true; await nextTick();
  expect(mockWorkspace.reconnect).toHaveBeenCalledTimes(1);
  expect(mockWorkspace.refresh).toHaveBeenCalledTimes(1);
  wrapper.unmount(); wrapper = undefined;
  mockOnline.value = false; await nextTick();
  mockOnline.value = true; await nextTick();
  expect(mockWorkspace.reconnect).toHaveBeenCalledTimes(1);
});
