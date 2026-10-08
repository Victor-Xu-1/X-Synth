import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import AccountLoginForm from "./AccountLoginForm.vue";
import { API } from "@/common/api";
import { initializeLocale, setLocale } from "@/i18n";

const mockRoute = { query: {} };
const mockRouter = { replace: jest.fn() };
const mockWorkspace = {
  local: true,
  can: jest.fn(() => false),
  refresh: jest.fn(),
};
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}));
jest.mock("@/store/config", () => ({ useConfigStore: () => ({ envs: {} }) }));
jest.mock("@/store/workspace", () => ({
  useWorkspaceStore: () => mockWorkspace,
}));

const formStub = defineComponent({
  setup(_, { slots, expose }) {
    expose({
      validate: async () => ({ valid: true }),
      resetValidation: () => {},
    });
    return () => h("form", slots.default?.());
  },
});
const fieldStub = {
  props: ["modelValue"],
  template:
    '<div><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
};
const buttonStub = {
  props: ["disabled", "loading"],
  template: '<button :disabled="disabled"><slot /></button>',
};
const makeForm = (props) =>
  mount(AccountLoginForm, {
    props,
    global: {
      stubs: {
        LanguageMenu: true,
        "v-form": formStub,
        "v-text-field": fieldStub,
        "v-btn": buttonStub,
        "v-alert": { template: "<div><slot /></div>" },
        "v-divider": true,
        RouterLink: true,
      },
    },
  });
const fill = async (wrapper) => {
  await wrapper.get('[data-cy="username"] input').setValue("researcher");
  await wrapper.get('[data-cy="password"] input').setValue("test-only");
};

test("fresh English and Chinese labels preserve a pending-free login draft and disabled SSO without submitting", async () => {
  initializeLocale(null);
  const wrapper = makeForm({ sso: true });
  await fill(wrapper);
  const fields = wrapper.findAll("input").map((item) => item.element);
  expect(wrapper.text()).toContain("Single sign-on is not enabled in this workspace.");
  expect(wrapper.get('[data-cy="username"]').attributes("label")).toBe("Username");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.text()).toContain("当前工作区未启用单点登录。");
  expect(wrapper.get('[data-cy="username"]').attributes("label")).toBe("用户名");
  expect(wrapper.findAll("input").map((item) => item.element)).toEqual(fields);
  expect(fields.map((field) => field.value)).toEqual(["researcher", "test-only"]);
  expect(API.post).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  wrapper.unmount();
});
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockRoute.query = {};
  mockWorkspace.can.mockReturnValue(false);
});

test("uses native authentication and safe redirect after login", async () => {
  mockRoute.query = { redirect: "%2Fdrawing" };
  API.post.mockResolvedValue({ access_token: "unit-test-response" });
  const wrapper = makeForm();
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith(
    "/api/admin/token",
    expect.any(FormData),
  );
  expect(mockRouter.replace).toHaveBeenCalledWith("/drawing");
  expect(wrapper.find('[data-cy="guestSignup"]').exists()).toBe(false);
  wrapper.unmount();
});
test("shows native failure without navigation", async () => {
  API.post.mockRejectedValue(new Error("Unauthorized"));
  const wrapper = makeForm();
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[data-cy="auth-error"]').text()).toContain("登录失败");
  expect(mockRouter.replace).not.toHaveBeenCalled();
  wrapper.unmount();
});
test("prevents duplicate pending authentication requests", async () => {
  let finish;
  API.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = makeForm();
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(1);
  finish({ access_token: "unit-test-response" });
  await flushPromises();
  wrapper.unmount();
});
test("rejects incomplete authentication success responses", async () => {
  API.post.mockResolvedValue({});
  const wrapper = makeForm();
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[data-cy="auth-error"]').text()).toContain("登录失败");
  expect(mockRouter.replace).not.toHaveBeenCalled();
  wrapper.unmount();
});
test("registers then authenticates without a generated guest", async () => {
  API.post
    .mockResolvedValueOnce("OK")
    .mockResolvedValueOnce({ access_token: "unit-test-response" });
  const wrapper = makeForm();
  await wrapper.get('[data-cy="signup"]').trigger("click");
  await fill(wrapper);
  await wrapper.get('[data-cy="email"] input').setValue("test@example.com");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).toHaveBeenNthCalledWith(
    1,
    "/api/user/register",
    {
      username: "researcher",
      password: "test-only",
      email: "test@example.com",
    },
    true,
  );
  expect(API.post).toHaveBeenNthCalledWith(
    2,
    "/api/admin/token",
    expect.any(FormData),
  );
  wrapper.unmount();
});
test("admin login retains server authentication and admin destination", async () => {
  API.post.mockResolvedValue({ access_token: "unit-test-response" });
  const wrapper = makeForm({ admin: true });
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mockRouter.replace).toHaveBeenCalledWith("/admin");
  expect(wrapper.find('[data-cy="signup"]').exists()).toBe(false);
  wrapper.unmount();
});
