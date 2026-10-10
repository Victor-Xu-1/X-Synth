import { reactive } from "vue";
import router from "./index";
import { sectionNavigation } from "@/common/workspace-navigation";

const mockWorkspace = reactive({ session: null, error: "", refreshCore: jest.fn(), can: jest.fn() });
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("@/common/workspace-session", () => ({ hasWorkspaceAccess: jest.fn().mockResolvedValue(true) }));
jest.mock("vue-router", () => ({
  createWebHistory: jest.fn(() => ({ state: { position: 0 } })),
  createRouter: (options) => ({ options, beforeEach: jest.fn(), afterEach: jest.fn(), onError: jest.fn() }),
}));
const adminRoute = () => router.options.routes.find((route) => route.path === "/").children.find((route) => route.path === "admin");
const destination = () => ({ path: "/admin", fullPath: "/admin", query: {}, meta: { workspace: true, ...adminRoute().meta } });
const guard = (to) => router.beforeEach.mock.calls[0][0](to);
const session = (updates = {}) => ({ mode: "askcos", owner: "researcher", administrator: false, workspace_access: true, ...updates });
beforeEach(() => {
  mockWorkspace.session = session(); mockWorkspace.error = "";
  mockWorkspace.refreshCore.mockReset().mockResolvedValue(undefined);
  mockWorkspace.can.mockReset().mockReturnValue(true);
  localStorage.clear();
});

test("the existing native self-service branch is not hidden by the administrator module gate", () => {
  expect(adminRoute().meta.feature).toBe("native_account");
});

test.each([false, true])("server-verified native account access works for administrator=%s without inferring authority from browser storage", async (administrator) => {
  mockWorkspace.session = session({ administrator });
  expect(await guard(destination())).toBeUndefined();
  expect(mockWorkspace.refreshCore).toHaveBeenCalledWith(true);
});

test.each([
  null, session({ mode: "local", administrator: true }), session({ owner: "guest_protocol" }),
  session({ workspace_access: false }), session({ administrator: "true" }), session({ owner: "" }),
])("local, guest, unauthenticated and malformed authority cannot enter native self-service: %j", async (value) => {
  mockWorkspace.session = value;
  expect(await guard(destination())).toEqual({ name: "登录", query: { redirect: "/admin" } });
});

test("a failed authoritative refresh cannot reuse an old native account role", async () => {
  mockWorkspace.refreshCore.mockRejectedValue(new Error("protocol unavailable"));
  expect(await guard(destination())).toEqual({ name: "登录", query: { redirect: "/admin" } });
});

test("only the existing account-specific navigation item is enabled for native ordinary users", () => {
  const navigation = sectionNavigation({ path: "/admin", query: {} }, { native_account: true, administrator: false });
  expect(navigation.items.find((item) => item.to === "/admin")).toMatchObject({ feature: "native_account" });
});
