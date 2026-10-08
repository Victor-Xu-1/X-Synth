import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { DEFAULT_LOCALE, initializeLocale, setLocale } from "@/i18n";
import { buildWorkbenchRequest, defaultSearchSettings } from "@/common/workbench-model";
import RouteSearchSettings from "./RouteSearchSettings.vue";
import OneStepSettings from "./OneStepSettings.vue";

const wrappers = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("fresh English settings switch to Chinese while preserving the draft, replay and control identity", async () => {
  initializeLocale(null);
  expect(DEFAULT_LOCALE).toBe("en");
  const name = ref("任务名称"), smiles = "[13CH3][C@H](F)C(=O)[O-].[Na+]";
  const settings = reactive({ ...defaultSearchSettings(), minutes: 127 / 60 });
  const wrapper = mount({
    components: { RouteSearchSettings },
    setup: () => ({ name, settings }),
    template: '<RouteSearchSettings v-model:name="name" v-model:settings="settings" />',
  });
  wrappers.push(wrapper);
  const original = buildWorkbenchRequest({ name: name.value, smiles, settings });
  const nameInput = wrapper.get('[name="task_name"]');
  const minuteInput = wrapper.get('[name="expansion_time_minutes"]');
  expect(wrapper.text()).toContain("Task name");
  expect(wrapper.text()).toContain("Advanced parameters");
  expect(nameInput.element.value).toBe("任务名称");
  expect(minuteInput.attributes("aria-label")).toBe("Search time per round (minutes)");
  wrapper.get("details").element.open = true;
  const updates = wrapper.getComponent(RouteSearchSettings).emitted();
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.text()).toContain("任务名称");
  expect(minuteInput.attributes("aria-label")).toBe("每轮搜索时长（分钟）");
  expect(wrapper.get('[name="task_name"]').element).toBe(nameInput.element);
  expect(nameInput.element.value).toBe("任务名称");
  expect(wrapper.get("details").element.open).toBe(true);
  expect(buildWorkbenchRequest({ name: name.value, smiles, settings })).toEqual(original);
  expect(wrapper.getComponent(RouteSearchSettings).emitted()).toEqual(updates);
  await nameInput.setValue("我的路线 / [Na+]");
  await wrapper.get('[name="max_routes"]').setValue(6);
  setLocale("en", { persist: false });
  await flushPromises();
  expect(name.value).toBe("我的路线 / [Na+]");
  expect(buildWorkbenchRequest({ name: name.value, smiles, settings })).toEqual({
    ...original, description: "我的路线 / [Na+]", max_routes: 6,
  });
});

test("one-step purpose labels change without changing the selected native model or numerical parameters", async () => {
  initializeLocale(null);
  const settings = reactive({ model: "pistachio_ringbreaker", count: 1000, threshold: 0.75 });
  const wrapper = mount(OneStepSettings, { props: { modelValue: settings } });
  wrappers.push(wrapper);
  const select = wrapper.get("select");
  expect(select.findAll("option").map((option) => option.text())).toEqual(["General disconnections", "Ring disconnections"]);
  expect(select.element.value).toBe("pistachio_ringbreaker");
  expect(select.attributes("title")).toBe("Pistachio Ringbreaker");
  expect(wrapper.get('[name="minimum_plausibility"]').attributes("title")).toContain("not measured yield");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(select.findAll("option").map((option) => option.text())).toEqual(["通用断键", "环系拆分"]);
  expect(wrapper.get("select").element).toBe(select.element);
  expect(settings).toEqual({ model: "pistachio_ringbreaker", count: 1000, threshold: 0.75 });
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  await select.setValue("pistachio");
  expect(settings.model).toBe("pistachio");
  expect(settings.count).toBe(1000);
  expect(settings.threshold).toBe(0.75);
});
