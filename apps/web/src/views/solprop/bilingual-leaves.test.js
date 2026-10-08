import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";
import SolubilityPredict from "./tabs/SolubilityPredictView.vue";
import SolventScreen from "./tabs/SolventScreenView.vue";
import { API } from "@/common/api";
jest.mock("@/common/api", () => ({ API: { get: jest.fn(), runCeleryTask: jest.fn() } }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/SmilesImage", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("vue-chartjs", () => ({ Line: { template: '<div />' }, Bar: { template: '<div />' } }));
jest.mock("@/assets/emptySolProp.svg", () => "empty-solubility.svg");
jest.mock("@/assets/emptyChart.svg", () => "empty-chart.svg");

const Box = { template: '<div><slot /><slot name="activator" :props="{}" /></div>' };
const Input = defineComponent({ props: ["modelValue", "label"], emits: ["update:modelValue"],
  template: '<input :value="modelValue" :aria-label="label" @input="$emit(\'update:modelValue\', $event.target.value)" />' });
const stubs = Object.fromEntries([
  "VContainer", "VRow", "VCol", "VSheet", "VForm", "VMenu", "VList", "VListItem", "VListItemTitle", "VAlert", "VChip",
  "VCard", "VCardTitle", "VCardText", "VCardActions", "VExpandTransition", "VExpansionPanels", "VExpansionPanel", "VExpansionPanelText",
].map((name) => [name, Box]));
Object.assign(stubs, { StructureInput: Input, VTextField: Input, VTextarea: Input, VFileInput: true, VIcon: true,
  VSpacer: true, VDivider: true, VImg: true, VSkeletonLoader: true, VBtn: { template: '<button><slot /></button>' },
  VSelect: { props: ["items", "label"], template: '<div>{{ label }}<span v-for="item in items" :key="item.key || item.value">{{ item.title || item }}</span><slot /></div>' },
  VTooltip: { props: ["location", "text", "modelValue"], template: '<slot name="activator" :props="{}" />' }, WorkbenchDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  VDataTable: { props: ["headers"], template: '<div><span v-for="header in headers" :key="header.key">{{ header.title }}</span></div>' },
  SmilesImage: true, SolubilityModal: true, ErrorDialog: true,
});
beforeEach(() => { API.get.mockReset().mockResolvedValue("source tooltip fixture"); API.runCeleryTask.mockReset(); });

test("English solubility form/results captions and Chinese return preserve raw requests, header data, records and draft DOM", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const wrapper = mount(SolubilityPredict, { global: { stubs } });
  try {
    await flushPromises();
    await wrapper.get('[aria-label="Solute"]').setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
    await wrapper.get('[aria-label="Solvent"]').setValue("O");
    wrapper.vm.results = [{ Solute: wrapper.vm.solute, Solvent: "O", Temp: 298, st_1: 0, st_2: null, warning_message: "实验原文" }];
    const input = wrapper.get('[aria-label="Solute"]').element;
    const body = JSON.stringify(wrapper.vm.buildRequestBody("legacy")), data = JSON.stringify(wrapper.vm.results), fields = JSON.stringify(wrapper.vm.fields);
    expect(wrapper.text()).toContain("More parameters"); expect(wrapper.text()).toContain("Input reference data");
    expect(wrapper.vm.localizedFields.find((field) => field.key === "Solute").title).toBe("Solute");
    const keys = wrapper.vm.allfields.map((item) => item.key);
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.get('[aria-label="溶质"]').element).toBe(input); expect(wrapper.text()).toContain("更多参数");
    expect(wrapper.vm.allfields.map((item) => item.key)).toEqual(keys);
    expect(JSON.stringify(wrapper.vm.buildRequestBody("legacy"))).toBe(body); expect(JSON.stringify(wrapper.vm.results)).toBe(data);
    expect(JSON.stringify(wrapper.vm.fields)).toBe(fields); expect(API.runCeleryTask).not.toHaveBeenCalled();
    wrapper.vm.selectedColumnCategories = ["输入参考数据", "输入溶质数据"];
    setLocale(DEFAULT_LOCALE, { persist: false }); await flushPromises();
    wrapper.vm.deselectColumn({ value: "输入参考数据", title: "Input reference data" });
    expect(wrapper.vm.selectedColumnCategories).toEqual(["输入溶质数据"]);
    expect(JSON.stringify(wrapper.vm.results)).toBe(data);
  } finally { wrapper.unmount(); }
});

test("screening chart captions use complete named phrases while collection names, source structures, axes values and units remain raw", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const wrapper = mount(SolventScreen, { global: { stubs } });
  try {
    await flushPromises(); wrapper.vm.customSolventSets = { "研究者原始集合": ["[Na+].CC(=O)[O-]", "N[C@@H](C)C(=O)O"] };
    wrapper.vm.results = [{ Solvent: "[Na+].CC(=O)[O-]", Temp: 298, st_1: 0 }];
    const original = JSON.stringify(wrapper.vm.results), collections = JSON.stringify(wrapper.vm.customSolventSets);
    expect(wrapper.vm.fields.find((field) => field.key === "298").title).toBe("298 K solubility (method 1) [mg/mL]");
    expect(wrapper.vm.chartOptions.scales.y.title.text).toBe("Solubility (method 1) [mg/mL]");
    expect(wrapper.vm.solventSetOptions.some((item) => item.title === "研究者原始集合" && item.value === "研究者原始集合")).toBe(true);
    const selection = [wrapper.vm.selectedMethod, wrapper.vm.selectedUnits, wrapper.vm.selectedX];
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.vm.chartOptions.scales.y.title.text).toBe("溶解度（方法 1）[mg/mL]");
    expect([wrapper.vm.selectedMethod, wrapper.vm.selectedUnits, wrapper.vm.selectedX]).toEqual(selection);
    expect(JSON.stringify(wrapper.vm.results)).toBe(original); expect(JSON.stringify(wrapper.vm.customSolventSets)).toBe(collections);
    expect(API.runCeleryTask).not.toHaveBeenCalled();
  } finally { wrapper.unmount(); }
});
