import { nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import WorkspaceUpdateNotice from "./WorkspaceUpdateNotice.vue";

jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRoute: () => mockRoute }));
const mockWorkspace = reactive({ health: null, error: "" });
const mockRoute = reactive({ fullPath: "/process?record=abc#product" });
const nextVersion = `${Number(__X_SYNTH_VERSION__.split(".")[0]) + 1}.0.0`;
let wrapper;
beforeEach(() => { mockWorkspace.health = null; mockWorkspace.error = ""; mockRoute.fullPath = "/process?record=abc#product"; });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
function setup() { wrapper = mount(WorkspaceUpdateNotice, { global: { stubs: { VIcon: true } } }); }

test("only a newer confirmed running release shows a quiet update notice", async () => {
  setup(); expect(wrapper.find('[role="status"]').exists()).toBe(false);
  mockWorkspace.health = { version: __X_SYNTH_VERSION__ }; await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  mockWorkspace.health = { version: nextVersion }; await nextTick();
  expect(wrapper.get('[role="status"]').text()).toContain(`v${nextVersion}`);
  mockWorkspace.error = "unavailable"; await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});

test("opens the same route separately without reload, storage or losing the old form", () => {
  mockWorkspace.health = { version: nextVersion }; setup();
  const link = wrapper.get("a");
  expect(link.attributes("href")).toBe(mockRoute.fullPath);
  expect(link.attributes("target")).toBe("_blank");
  expect(link.attributes("rel")).toBe("noopener");
  expect(link.text()).toContain("打开新版");
});

test.each(["//external.test/path", "/\\external.test/path", "/\n/path", "https://external.test/", "javascript:alert(1)", undefined])("never opens an untrusted route target %p", (fullPath) => {
  mockWorkspace.health = { version: nextVersion }; mockRoute.fullPath = fullPath; setup();
  expect(wrapper.get("a").attributes("href")).toBe("/");
});
