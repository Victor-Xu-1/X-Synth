import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";
import {
  defaultSearchSettings,
  buildWorkbenchRequest,
} from "@/common/workbench-model";
import RouteSearchSettings from "./RouteSearchSettings.vue";
import OneStepSettings from "./OneStepSettings.vue";

const wrappers = [];
function render(component, props) {
  const wrapper = mount(component, { props });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("route search uses chemical labels and collapsed expert fields without changing defaults", async () => {
  const settings = reactive(defaultSearchSettings());
  const original = buildWorkbenchRequest({ smiles: "CCO", name: "", settings });
  const wrapper = render(RouteSearchSettings, { name: "", settings });
  expect(wrapper.text()).toContain("每轮时长（分钟）");
  expect(wrapper.get('[name="expansion_time_minutes"]').attributes("aria-label")).toBe("每轮搜索时长（分钟）");
  expect(wrapper.text()).not.toMatch(/搜索预算|终点判定/);
  const expert = wrapper.get("details");
  expect(expert.element.open).toBe(false);
  expect(expert.get('input[name="max_depth"]').element.value).toBe("12");
  expect(
    expert.get('input[name="minimum_plausibility"]').attributes("step"),
  ).toBe("any");
  await wrapper.get('input[name="max_routes"]').setValue(6);
  await wrapper.get('input[name="expansion_time_minutes"]').setValue(127 / 60);
  expect(buildWorkbenchRequest({ smiles: "CCO", name: "", settings })).toEqual({
    ...original,
    max_routes: 6,
    expansion_time: 127,
  });
});

test("replayed expert parameters stay intact when the section is closed and unrelated fields are edited", async () => {
  const settings = reactive({
    ...defaultSearchSettings(),
    strategies: ["retro_star"],
    minRoutes: 4,
    maxRoutes: 8,
    maxPaths: 80,
    repairAttempts: 0,
    minutes: 127 / 60,
    tuning: {
      max_depth: 15,
      max_branching: 40,
      template_count: 800,
      cumulative_probability: 0.000123,
      minimum_plausibility: 0.755,
    },
  });
  const original = buildWorkbenchRequest({ smiles: "CCO", name: "", settings });
  const wrapper = render(RouteSearchSettings, { settings });
  expect(
    wrapper.get('input[name="expansion_time_minutes"]').element.checkValidity(),
  ).toBe(true);
  await wrapper.get('input[name="max_routes"]').setValue(7);
  expect(buildWorkbenchRequest({ smiles: "CCO", name: "", settings })).toEqual({
    ...original,
    max_routes: 7,
  });
  expect(
    wrapper.get('input[name="cumulative_probability"]').element.value,
  ).toBe("0.000123");
});

test.each([60, 61, 127, 7199, 7200])(
  "native minute controls accept and preserve the supported %i-second replay",
  (seconds) => {
    const settings = { ...defaultSearchSettings(), minutes: seconds / 60 };
    const wrapper = render(RouteSearchSettings, { settings });
    const input = wrapper.get('input[name="expansion_time_minutes"]');
    expect(input.attributes()).toMatchObject({
      min: "1",
      max: "120",
      step: "any",
    });
    expect(input.element.checkValidity()).toBe(true);
    expect(
      buildWorkbenchRequest({ smiles: "CCO", name: "", settings })
        .expansion_time,
    ).toBe(seconds);
  },
);

test.each([59, 7201])(
  "native minute controls still reject the out-of-range %i-second value",
  (seconds) => {
    const settings = { ...defaultSearchSettings(), minutes: seconds / 60 };
    const wrapper = render(RouteSearchSettings, { settings });
    expect(
      wrapper
        .get('input[name="expansion_time_minutes"]')
        .element.checkValidity(),
    ).toBe(false);
    expect(() =>
      buildWorkbenchRequest({ smiles: "CCO", name: "", settings }),
    ).toThrow();
  },
);

test("one-step model choices use chemical purposes while retaining native model names", async () => {
  const settings = reactive({
    model: "pistachio",
    count: 1000,
    threshold: 0.75,
  });
  const wrapper = render(OneStepSettings, { modelValue: settings });
  expect(wrapper.get("details").element.open).toBe(false);
  expect(
    wrapper
      .get("select")
      .findAll("option")
      .map((option) => option.text()),
  ).toEqual(["通用断键", "环系拆分"]);
  expect(wrapper.get("select").attributes("title")).toBe("Pistachio");
  await wrapper.get("select").setValue("pistachio_ringbreaker");
  expect(settings.model).toBe("pistachio_ringbreaker");
  expect(wrapper.get("select").attributes("title")).toBe(
    "Pistachio Ringbreaker",
  );
  expect(wrapper.get("details").text()).toContain("Pistachio Ringbreaker");
  expect(settings.count).toBe(1000);
  expect(settings.threshold).toBe(0.75);
  expect(wrapper.text()).not.toContain("FF 筛选阈值");
  expect(
    wrapper.get('input[name="minimum_plausibility"]').attributes("title"),
  ).toContain("不是实测收率或实验成功率");
});

test("one-step expert bounds and typed numeric values are unchanged", async () => {
  const settings = reactive({
    model: "pistachio",
    count: 1000,
    threshold: 0.75,
  });
  const wrapper = render(OneStepSettings, { modelValue: settings });
  const templates = wrapper.get('input[name="template_count"]');
  const threshold = wrapper.get('input[name="minimum_plausibility"]');
  expect(templates.attributes("title")).toContain("max_num_templates");
  expect(threshold.attributes("title")).toContain("fast_filter_threshold");
  expect(templates.attributes()).toMatchObject({
    min: "10",
    max: "5000",
    type: "number",
  });
  expect(threshold.attributes()).toMatchObject({
    min: "0",
    max: "1",
    step: "0.01",
    type: "number",
  });
  await templates.setValue(2000);
  await threshold.setValue(0.8);
  expect(settings).toEqual({ model: "pistachio", count: 2000, threshold: 0.8 });
});

test.each([
  [RouteSearchSettings, { settings: defaultSearchSettings() }],
  [
    OneStepSettings,
    { modelValue: { model: "pistachio", count: 1000, threshold: 0.75 } },
  ],
])(
  "disabled settings lock all native controls including collapsed ones",
  (component, props) => {
    const wrapper = render(component, { ...props, disabled: true });
    for (const control of wrapper.findAll("input, select")) {
      expect(control.element.disabled).toBe(true);
      expect(control.element.closest("label")).not.toBeNull();
    }
  },
);

test.each([
  "RouteSearchSettings.vue",
  "OneStepSettings.vue",
  "RouteImportPanel.vue",
])("%s compiles with the real Vue compiler", (filename) => {
  const source = readFileSync(resolve(__dirname, filename), "utf8");
  const { descriptor, errors } = parse(source, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "settings" });
  expect(
    compileTemplate({
      filename,
      id: "settings",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "data-v-settings",
        source: style.content,
        scoped: style.scoped,
      }).errors,
    ).toEqual([]);
});

test("route document entry identifies JSON rather than promising chemical drawing file support", () => {
  const source = readFileSync(
    resolve(__dirname, "RouteImportPanel.vue"),
    "utf8",
  );
  const { descriptor } = parse(source);
  expect(descriptor.template.content).toContain(
    'accept=".json,application/json"',
  );
  expect(descriptor.template.content).toContain("X-Synth 路线 JSON");
  expect(descriptor.template.content).toContain("MOL/SDF 是分子结构文件");
  expect(descriptor.template.content).toContain("不支持 CDX");
  expect(descriptor.template.content).toContain("打开路线文件");
  expect(source).toContain("importRouteDocument(API, file)");
});
