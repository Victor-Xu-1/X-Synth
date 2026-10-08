import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted, ref } from "vue";
import LanguageMenu from "./LanguageMenu.vue";
import { DEFAULT_LOCALE, initializeLocale, LOCALE_KEY, LOCALES, useUiLanguage } from "@/i18n";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");
const wrappers = [], hosts = [];
function preference(initial) {
  const saved = new Map(initial ? [[LOCALE_KEY, initial]] : []);
  return { document: { documentElement: {} },
    localStorage: { getItem: jest.fn((key) => saved.get(key)), setItem: jest.fn((key, value) => saved.set(key, value)) },
    addEventListener() {}, removeEventListener() {}, saved };
}
async function setup(component = LanguageMenu) {
  const host = document.createElement("div"); document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(component, { attachTo: host, global: { plugins: [createVuetify({ components, theme: false })] } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
async function open(wrapper) {
  await wrapper.get('[data-cy="ui-language-menu"]').trigger("click");
  await flushPromises();
  return [...document.querySelectorAll('[role="menuitemradio"]')];
}
beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); hosts.splice(0).forEach((host) => host.remove());
  initializeLocale(null);
});

test("fresh startup is English and the menu iterates the complete registry in endonym order", async () => {
  const target = preference(); initializeLocale(target);
  const wrapper = await setup();
  expect(DEFAULT_LOCALE).toBe("en");
  expect(useUiLanguage().locale.value).toBe("en");
  expect(wrapper.get("button").attributes("aria-label")).toBe("Language");
  const options = await open(wrapper);
  expect(options.map((option) => option.dataset.locale)).toEqual(LOCALES.map((item) => item.value));
  expect(options.map((option) => option.textContent.trim())).toEqual(LOCALES.map((item) => item.label));
  expect(options[0].textContent.trim()).toBe("English");
  expect(options.some((option) => option.textContent.trim() === "简体中文")).toBe(true);
  expect(options[0].getAttribute("aria-checked")).toBe("true");
  expect(wrapper.get("button").attributes("aria-haspopup")).toBe("menu");
  expect(target.localStorage.getItem).toHaveBeenCalledWith(LOCALE_KEY);
});

test("explicit Chinese selection persists only the language preference and reload initialization respects it", async () => {
  const target = preference(); initializeLocale(target);
  const wrapper = await setup();
  const options = await open(wrapper);
  options.find((option) => option.dataset.locale === "zh-CN").click(); await flushPromises();
  expect(useUiLanguage().locale.value).toBe("zh-CN");
  expect(target.localStorage.setItem.mock.calls).toEqual([[LOCALE_KEY, "zh-CN"]]);
  expect(target.document.documentElement.lang).toBe("zh-CN");
  initializeLocale(target);
  expect(useUiLanguage().locale.value).toBe("zh-CN");
  expect(wrapper.get("button").attributes("aria-label")).toBe("语言");
});

test("native keyboard opening and locale changes keep an existing input node and values without remount", async () => {
  initializeLocale(preference());
  let mounts = 0, unmounts = 0;
  const Probe = defineComponent({ setup() {
    const draft = ref("[13CH3][C@H]([NH3+])CO.[Cl-]");
    onMounted(() => mounts++); onUnmounted(() => unmounts++);
    return () => h("div", [h(LanguageMenu), h("input", { value: draft.value })]);
  } });
  const wrapper = await setup(Probe), input = wrapper.get("input").element;
  await wrapper.get("button").trigger("keydown", { key: "ArrowDown" }); await flushPromises();
  const options = [...document.querySelectorAll('[role="menuitemradio"]')];
  expect(options).toHaveLength(LOCALES.length);
  options.find((option) => option.dataset.locale === "zh-CN").click(); await flushPromises();
  expect(wrapper.get("input").element).toBe(input);
  expect(input.value).toBe("[13CH3][C@H]([NH3+])CO.[Cl-]");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
  expect(wrapper.emitted("navigate")).toBeUndefined();
  expect(wrapper.emitted("submit")).toBeUndefined();
});

test("preference failure stays visible in the open native menu and Escape can still dismiss it", async () => {
  const target = preference();
  target.localStorage.setItem = jest.fn(() => { throw new Error("preference store denied"); });
  initializeLocale(target);
  const wrapper = await setup();
  const options = await open(wrapper);
  options.find((option) => option.dataset.locale === "zh-CN").click(); await flushPromises();
  expect(useUiLanguage().locale.value).toBe("zh-CN");
  expect(wrapper.getComponent(components.VMenu).props("modelValue")).toBe(true);
  expect(wrapper.getComponent(components.VList).isVisible()).toBe(true);
  expect(document.querySelector(".language-preference-error").textContent).toContain("语言偏好未能保存");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(wrapper.getComponent(components.VMenu).props("modelValue")).toBe(false);
  expect(target.localStorage.setItem.mock.calls).toEqual([[LOCALE_KEY, "zh-CN"]]);
});
