import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, useRoute } from "vue-router";
import { initializeLocale, setLocale, useUiLanguage, useUiPageTitle } from "./index";

test("page titles follow language and real router state without remounting inputs", async () => {
  initializeLocale(null);
  const input = defineComponent({ setup() {
    useUiPageTitle(useRoute());
    const { widgetLocale } = useUiLanguage();
    return () => h("div", { "data-widget-locale": widgetLocale.value }, [
      h("input", { value: "[13CH3][C@H]([NH3+])CO.[Cl-]" }),
    ]);
  } });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/process", component: input, meta: { title: "工艺核算" } },
    { path: "/environments", component: input, meta: { title: "环境部署" } },
  ] });
  await router.push("/process"); await router.isReady();
  const wrapper = mount(defineComponent({ template: "<router-view />" }), { global: { plugins: [router] } });
  try {
    const element = wrapper.get("input").element;
    expect(document.title).toBe("Process accounting - X-Synth");
    expect(wrapper.get("[data-widget-locale]").attributes("data-widget-locale")).toBe("en");
    setLocale("zh-CN", { persist: false }); await nextTick();
    expect(document.title).toBe("工艺核算 - X-Synth");
    expect(wrapper.get("[data-widget-locale]").attributes("data-widget-locale")).toBe("zhHans");
    expect(wrapper.get("input").element).toBe(element);
    expect(element.value).toBe("[13CH3][C@H]([NH3+])CO.[Cl-]");
    expect(router.currentRoute.value.fullPath).toBe("/process");
    await router.push("/environments");
    expect(document.title).toBe("环境部署 - X-Synth");
    setLocale("en", { persist: false }); await nextTick();
    expect(document.title).toBe("Environments - X-Synth");
  } finally { wrapper.unmount(); }
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(document.title).toBe("Environments - X-Synth");
});
