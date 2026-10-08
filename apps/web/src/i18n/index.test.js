import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUnmounted, ref } from "vue";
import { buildCatalog } from "./catalog";
import { DEFAULT_LOCALE, i18n, initializeLocale, LOCALE_KEY, setLocale, uiText, useUiLanguage } from "./index";

afterEach(() => initializeLocale(null));

test("English is the production default and Chinese uses the same reactive language authority", () => {
  initializeLocale(null);
  expect(DEFAULT_LOCALE).toBe("en");
  expect(i18n.global.locale.value).toBe("en");
  expect(uiText("工艺核算")).toBe("Process accounting");
  expect(useUiLanguage().widgetLocale.value).toBe("en");
  setLocale("zh-CN", { persist: false });
  expect(useUiLanguage().widgetLocale.value).toBe("zhHans");
  expect(uiText("工艺核算")).toBe("工艺核算");
});

test("only the dedicated nonsecret preference is read or saved, and unsupported values never enable another language", () => {
  let listener;
  const target = {
    document: { documentElement: {} }, localStorage: { getItem: jest.fn(() => "en"), setItem: jest.fn() },
    addEventListener: jest.fn((_, value) => { listener = value; }), removeEventListener: jest.fn(),
  };
  initializeLocale(target);
  expect(target.localStorage.getItem).toHaveBeenCalledTimes(1);
  expect(target.localStorage.getItem).toHaveBeenCalledWith(LOCALE_KEY);
  expect(target.document.documentElement.lang).toBe("en");
  setLocale("zh-CN");
  expect(target.localStorage.setItem).toHaveBeenCalledWith(LOCALE_KEY, "zh-CN");
  listener({ key: "other-key", newValue: "en" });
  expect(i18n.global.locale.value).toBe("zh-CN");
  listener({ key: LOCALE_KEY, newValue: "en" });
  expect(i18n.global.locale.value).toBe("en");
  listener({ key: LOCALE_KEY, newValue: "invalid" });
  expect(i18n.global.locale.value).toBe("en");
  expect(() => setLocale("invalid")).toThrow(RangeError);
  listener({ key: LOCALE_KEY, newValue: null });
  expect(i18n.global.locale.value).toBe("en");
});

test.each([null, "unknown"])("a missing or unsupported saved preference %s starts in English", (saved) => {
  const target = { document: { documentElement: {} },
    localStorage: { getItem: () => saved }, addEventListener() {}, removeEventListener() {},
  };
  initializeLocale(target);
  expect(i18n.global.locale.value).toBe("en");
  expect(target.document.documentElement.lang).toBe("en");
});

test("preference storage failure keeps the selected language and does not prevent workspace rendering", () => {
  initializeLocale({ document: { documentElement: {} },
    localStorage: { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } },
    addEventListener() {}, removeEventListener() {},
  });
  setLocale("en");
  expect(uiText("工作区")).toBe("Workspace");
  expect(useUiLanguage().preferenceError.value).toContain("could not be saved");
});

test("locale updates do not remount inputs, change numerical values or modify user and chemical source text", async () => {
  let mounts = 0, unmounts = 0;
  const draft = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  const Probe = defineComponent({ setup() {
    const input = ref(draft), mass = ref("0");
    onMounted(() => mounts++); onUnmounted(() => unmounts++);
    return () => h("div", [h("label", uiText("名称")), h("input", { value: input.value, onInput: (event) => { input.value = event.target.value; } }),
      h("input", { type: "number", value: mass.value })]);
  } });
  const wrapper = mount(Probe);
  try {
    const inputs = wrapper.findAll("input").map((item) => item.element);
    setLocale("en", { persist: false }); await flushPromises();
    expect(wrapper.get("label").text()).toBe("Name");
    expect(wrapper.findAll("input").map((item) => item.element)).toEqual(inputs);
    expect(inputs.map((item) => item.value)).toEqual([draft, "0"]);
    expect(uiText(draft)).toBe(draft);
    expect(uiText("研究者原始批次名称")).toBe("研究者原始批次名称");
    expect(mounts).toBe(1); expect(unmounts).toBe(0);
  } finally { wrapper.unmount(); }
});

test("catalog construction rejects incomplete or competing translations instead of silently replacing them", () => {
  expect(() => buildCatalog([[ ["名称", "Name"], ["名称", "Title"] ]])).toThrow("Conflicting");
  expect(() => buildCatalog([[ ["名称", ""] ]])).toThrow(TypeError);
  expect(buildCatalog([[ ["名称", "Name"] ], [ ["名称", "Name"] ]]).en["名称"]).toBe("Name");
});
