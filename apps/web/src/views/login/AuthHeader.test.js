import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import AccountLoginForm from "./AccountLoginForm.vue";
import SSOCallback from "./SSOCallback.vue";
import SSOLogout from "./SSOLogout.vue";
import AccountUserDialog from "../admin/AccountUserDialog.vue";
import { API } from "@/common/api";
import { initializeLocale, setLocale, useUiLanguage } from "@/i18n";

const mockRouter = { replace: jest.fn() };
const mockWorkspace = { local: true, can: jest.fn(() => false), refresh: jest.fn() };
jest.mock("vue-router", () => ({ useRoute: () => ({ query: {} }), useRouter: () => mockRouter }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/store/config", () => ({ useConfigStore: () => ({ envs: {} }) }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
const wrappers = [], hosts = [];
const formStub = defineComponent({
  setup(_, { slots, expose }) {
    expose({ validate: async () => ({ valid: true }), resetValidation() {} });
    return () => h("form", slots.default?.());
  },
});
const fieldStub = defineComponent({
  props: ["modelValue", "label", "type"],
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h("label", [props.label, h("input", {
      value: props.modelValue, type: props.type || "text",
      onInput: (event) => emit("update:modelValue", event.target.value),
    })]);
  },
});

beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
beforeEach(() => {
  jest.clearAllMocks();
  initializeLocale(null);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

async function setup(component, props, { nativeFields = false } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(component, { props, attachTo: host, global: {
    plugins: [createVuetify({ components, theme: false })],
    stubs: { "v-form": formStub, ...(nativeFields ? {} : { "v-text-field": fieldStub }),
      VDialog: { props: ["modelValue"], template: '<section v-if="modelValue"><slot /></section>' },
      RouterLink: { template: "<a><slot /></a>" } },
  } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
async function chooseChinese(wrapper) {
  const button = wrapper.get('[data-cy="ui-language-menu"]');
  button.element.focus();
  await button.trigger("keydown", { key: "ArrowDown" });
  await flushPromises();
  // VMenu schedules the first keyboard focus through two consecutive timers.
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  await flushPromises();
  const option = document.querySelector('[role="menuitemradio"][data-locale="zh-CN"]');
  expect(option).not.toBeNull();
  option.focus();
  const returnedFocus = jest.spyOn(button.element, "focus");
  option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
  expect(useUiLanguage().locale.value).toBe("zh-CN");
  expect(wrapper.getComponent(components.VMenu).props("modelValue")).toBe(false);
  expect(returnedFocus).toHaveBeenCalled();
  expect(document.activeElement === button.element).toBe(true);
}

test.each([
  ["ordinary login", {}], ["administrator login", { admin: true }], ["SSO login", { sso: true }],
])("%s has a standalone native language menu without submitting, routing or replacing its draft", async (_, props) => {
  const wrapper = await setup(AccountLoginForm, props);
  expect(wrapper.get(".auth-header .auth-brand").text()).toBe("X-Synth");
  expect(wrapper.get('.auth-header [data-cy="ui-language-menu"]').attributes("aria-label")).toBe("Language");
  await wrapper.get('[data-cy="username"] input').setValue("原始研究员");
  await wrapper.get('[data-cy="password"] input').setValue("unit-only unchanged draft");
  const inputs = wrapper.findAll("input").map((field) => field.element);
  await chooseChinese(wrapper);
  expect(wrapper.get('[data-cy="username"]').text()).toBe("用户名");
  expect(wrapper.findAll("input").map((field) => field.element)).toEqual(inputs);
  expect(inputs.map((field) => field.value)).toEqual(["原始研究员", "unit-only unchanged draft"]);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockWorkspace.refresh).toHaveBeenCalledTimes(1);
  if (props.sso) {
    expect(wrapper.text()).toContain("当前工作区未启用单点登录。");
    expect(wrapper.find('[data-cy="keycloakLogin"]').exists()).toBe(false);
  }
});

test("unconfigured SSO callback exposes the same menu and translates its existing error without new verification calls", async () => {
  const wrapper = await setup(SSOCallback);
  expect(wrapper.get('[role="alert"]').text()).toContain("Single sign-on did not complete or timed out.");
  await chooseChinese(wrapper);
  expect(wrapper.get('[role="alert"]').text()).toContain("单点登录未完成或已超时");
  expect(API.get).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test("SSO logout callback exposes the menu without repeating its existing return navigation", async () => {
  const wrapper = await setup(SSOLogout);
  expect(wrapper.get('[role="status"]').text()).toBe("Returning to the sign-in page.");
  expect(mockRouter.replace).toHaveBeenCalledTimes(1);
  await chooseChinese(wrapper);
  expect(wrapper.get('[role="status"]').text()).toBe("正在返回登录页。");
  expect(mockRouter.replace.mock.calls).toEqual([["/login"]]);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).not.toHaveBeenCalled();
});

test.each([
  ["standalone login", AccountLoginForm, {}, "请输入用户名", "Enter a username"],
  ["open account editor", AccountUserDialog, { modelValue: true, mode: "email", username: "原始账号", initialEmail: "invalid-email" }, "请输入有效的邮箱地址", "Enter a valid email address"],
])("%s translates an already-cached native validation error without revalidating or replacing the field", async (_, component, props, chinese, english) => {
  const wrapper = await setup(component, props, { nativeFields: true });
  const field = wrapper.getComponent(components.VTextField);
  await field.vm.validate(); await flushPromises();
  const input = field.get("input").element;
  const error = field.get(".v-messages__message").element;
  expect(error.textContent.trim()).toBe(english);
  const validate = jest.spyOn(field.vm, "validate");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(error.textContent.trim()).toBe(chinese);
  expect(field.get("input").element === input).toBe(true);
  expect(field.get(".v-messages__message").element === error).toBe(true);
  expect(validate).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled(); expect(API.get).not.toHaveBeenCalled();
  expect(wrapper.emitted("save")).toBeUndefined();
});
