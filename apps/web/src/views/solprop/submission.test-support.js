import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import SolubilityPredict from "./tabs/SolubilityPredictView.vue";
import SolventScreen from "./tabs/SolventScreenView.vue";
import { API } from "@/common/api";
import { saveAs } from "file-saver";

jest.mock("@/common/api", () => ({ API: {
  get: jest.fn(), runCeleryTask: jest.fn(),
  toErrorObject: jest.fn((error) => ({ string_error: error.message })),
} }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
jest.mock("@/components/SmilesImage", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("vue-chartjs", () => ({ Line: { template: "<div />" }, Bar: { template: "<div />" } }));
jest.mock("@/assets/emptySolProp.svg", () => "empty-solubility.svg");
jest.mock("@/assets/emptyChart.svg", () => "empty-chart.svg");

const Input = defineComponent({ props: ["modelValue", "label", "disabled"],
  template: '<input :value="modelValue" :aria-label="label" :disabled="disabled" />' });
const Box = { template: '<div><slot /><slot name="activator" :props="{}" /></div>' };
const stubs = Object.fromEntries([
  "VContainer", "VRow", "VCol", "VSheet", "VForm", "VMenu", "VList", "VListItemTitle", "VAlert", "VChip",
  "VCard", "VCardTitle", "VCardText", "VCardActions", "VExpandTransition", "VExpansionPanels", "VExpansionPanel", "VExpansionPanelText",
].map((name) => [name, Box]));
Object.assign(stubs, {
  StructureInput: Input, VTextField: Input, VTextarea: Input, VFileInput: Input, VSelect: Input,
  VBtn: { props: ["disabled", "loading"], template: '<button :disabled="disabled"><slot /></button>' },
  VListItem: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VDataTable: { props: ["headers", "items"], template: '<pre data-testid="rows">{{ JSON.stringify(items) }}</pre>' },
  VTooltip: { props: ["location", "text", "modelValue"], template: '<slot name="activator" :props="{}" />' },
  WorkbenchDialog: Box, VIcon: true, VSpacer: true, VDivider: true, VImg: true,
  VSkeletonLoader: true, SmilesImage: true, SolubilityModal: true,
  ErrorDialog: { props: ["errorObj"], template: '<div>{{ $tr(errorObj.string_error) }}</div>' },
});
const wrappers = [];
const NativeFileReader = FileReader;

beforeEach(() => {
  jest.clearAllMocks();
  API.get.mockResolvedValue("isolated tooltip protocol fixture");
  API.runCeleryTask.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  jest.restoreAllMocks();
});

export async function mountPrediction(data = {}) {
  const wrapper = mount(SolubilityPredict, { global: { stubs } });
  wrappers.push(wrapper);
  Object.assign(wrapper.vm, { solute: "[13CH3][C@H]([NH3+])CO.[Cl-]", solvent: "O", ...data });
  await flushPromises();
  return wrapper;
}

export async function mountScreen(data = {}) {
  const wrapper = mount(SolventScreen, { global: { stubs } });
  wrappers.push(wrapper);
  await wrapper.setData({ solute: "[13CH3][C@H]([NH3+])CO.[Cl-]", solvents: "O", temperatures: "298\n323", ...data });
  await flushPromises();
  return wrapper;
}

// These deferred responses prove lifecycle correctness, not native scientific results.
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new NativeFileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export function deferFileRead() {
  const reader = { readAsText: jest.fn(), abort: jest.fn() };
  jest.spyOn(globalThis, "FileReader").mockImplementation(() => reader);
  return reader;
}

export { API, saveAs, flushPromises };
