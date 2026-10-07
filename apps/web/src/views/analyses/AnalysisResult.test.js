import { mount, flushPromises } from "@vue/test-utils";
import { acceptsProcess } from "@/views/process/process-form";
import ConditionRecommendation from "@/views/forward/tab/ConditionRecommendation.vue";
import SynthesisPrediction from "@/views/forward/tab/SynthesisPrediction.vue";
import AnalysisResult from "./AnalysisResult.vue";
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", props: { smiles: String, allowCopy: Boolean }, template: '<span class="structure-identity">{{ smiles }}</span>' }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => true }) }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/views/assessment/AssessmentResults.vue", () => ({ props: ["result"], template: '<div class="assessment" />' }));
jest.mock("@/views/process/ProcessResults.vue", () => ({ props: ["result"], render() {
  if (this.result.brokenRenderer) throw new Error("renderer contract gap");
  return require("vue").h("div", { class: "process" });
} }));
jest.mock("@/views/process/process-form", () => ({ acceptsProcess: jest.fn().mockReturnValue(false) }));
jest.mock("@/views/optimization/RecommendationTable.vue", () => ({ props: ["result"], template: '<div class="optimization" />' }));
jest.mock("@/views/impurity/ImpurityResults.vue", () => ({ props: ["result"], template: '<div class="impurity" />' }));
jest.mock("@/views/optimization/optimization.css", () => ({}));
const setup = (kind, result) => mount(AnalysisResult, { props: { kind, result }, global: { stubs: {
  VBtn: { template: "<button><slot /></button>" }, VIcon: true, VProgressLinear: true,
  VTooltip: { props: ["text", "location"], template: '<slot name="activator" :props="{}" />' },
} } });
test.each(["assessment", "process", "impurity"])("malformed %s does not mount an unsafe renderer", (kind) => {
  const result = Object.freeze({}); const wrapper = setup(kind, result);
  expect(wrapper.find(`.${kind}`).exists()).toBe(false); expect(wrapper.find("button").exists()).toBe(false);
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  wrapper.unmount();
});
test("legacy labels remain readable text without drawing unconfirmed chemistry", () => {
  const wrapper = setup("conditions", { reactants: "", product: "", conditions: [{
    solvent: "CCO", reagent: "Reaxys 12345", catalyst: "", temperature: 0, score: 0,
  }] });
  expect(wrapper.get("tbody").text()).toContain("CCO");
  expect(wrapper.get("tbody").text()).toContain("Reaxys 12345");
  expect(wrapper.get("tbody").text()).toContain("未预测");
  expect(wrapper.findAll("tbody .structure-identity")).toHaveLength(0);
  expect(wrapper.text()).toContain("结构未确认");
  const describedBy = wrapper.getComponent(ConditionRecommendation).attributes("aria-describedby");
  expect(wrapper.get('[role="note"]').attributes("id")).toBe(describedBy);
  wrapper.unmount();
});
test("a nested renderer failure is contained and a subsequent valid result recovers", async () => {
  acceptsProcess.mockReturnValueOnce(true);
  const wrapper = setup("process", { brokenRenderer: true });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  await wrapper.setProps({ kind: "forward", result: { reactants: "", products: [] } });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("未返回产物候选");
  wrapper.unmount();
});
test("empty optimizer outputs are not passed to a first-row renderer", () => {
  const wrapper = setup("optimization", { recommendations: [], target: {}, versions: {}, selected_rows: [] });
  expect(wrapper.text()).toContain("没有实验建议"); expect(wrapper.find(".optimization").exists()).toBe(false);
  wrapper.unmount();
});
test.each(["conditions", "forward", "optimization"])("malformed %s outputs have visible errors, not a crash or an empty success", (kind) => {
  const wrapper = setup(kind, {});
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效"); expect(wrapper.find("table").exists()).toBe(false);
  wrapper.unmount();
});
test("empty model candidates stay read-only with distinct empty messages", () => {
  const forward = setup("forward", { reactants: "", products: [] });
  expect(forward.text()).toContain("未返回产物候选"); expect(forward.find("button").exists()).toBe(false);
  const conditions = setup("conditions", { reactants: "", product: "", conditions: [] });
  expect(conditions.text()).toContain("未返回条件候选");
  forward.unmount(); conditions.unmount();
});

test("history reuses the forward renderer with ranks, structure copy and export, without changing saved output", () => {
  // Presentation protocol fixture only; the numbers are not scientific acceptance data.
  const products = Object.freeze([
    Object.freeze({ product: "C[C@H](F)Cl", log_probability: -1, feasibility_score: 0 }),
    Object.freeze({ product: "CC(=O)[O-].[Na+]", log_probability: -2, feasibility_score: 1 }),
  ]);
  const result = Object.freeze({ reactants: "CCO", products, model: "protocol", asset_identity: "protocol-only" });
  const wrapper = setup("forward", result);
  const renderer = wrapper.getComponent(SynthesisPrediction);
  expect(renderer.props("results")).toBe(products);
  expect(renderer.props("submitted")).toBe(true);
  expect(wrapper.findAll('tbody th[scope="row"]').map((row) => row.text())).toEqual(["1", "2"]);
  expect(renderer.findAllComponents({ name: "SmilesImage" }).every((image) => image.props("allowCopy"))).toBe(true);
  expect(wrapper.get('[aria-label="导出产物候选"]').exists()).toBe(true);
  wrapper.unmount();
});

test("history reuses condition presentation with safe legacy labels and no FF execution control", () => {
  const row = Object.freeze({ solvent: "CCO", reagent: "raw model label", catalyst: "", temperature: 0, score: 0 });
  const result = Object.freeze({ reactants: "CCO", product: "CO", conditions: Object.freeze([row]) });
  const wrapper = setup("conditions", result);
  const renderer = wrapper.getComponent(ConditionRecommendation);
  expect(renderer.props("allowEvaluation")).toBe(false);
  expect(renderer.props("submitted")).toBe(true);
  expect(renderer.props("results")[0].ingredients.solvent).toEqual({ label: "CCO", smiles: null, status: "label_only" });
  expect(wrapper.find('[data-cy="evaluate-reaction"]').exists()).toBe(false);
  expect(wrapper.findAll("tbody .structure-identity")).toHaveLength(0);
  expect(wrapper.text()).toContain("结构未确认");
  expect(row.ingredients).toBeUndefined();
  wrapper.unmount();
});

test("validated ingredient structures keep exact identity while raw labels remain visibly unconfirmed", () => {
  const solvent = "CC(=O)[O-].[Na+]", label = "[AlH7-].[Li+]";
  const result = { reactants: "CCO", product: "CO", conditions: [{
    solvent, reagent: label, catalyst: "", temperature: 0, score: 0,
    ingredients: {
      solvent: { label: solvent, smiles: solvent, status: "structure" },
      reagent: { label, smiles: null, status: "label_only" },
      catalyst: { label: "", smiles: null, status: "not_predicted" },
    },
  }] };
  const wrapper = setup("conditions", result);
  expect(wrapper.get("tbody .structure-identity").text()).toBe(solvent);
  expect(wrapper.text()).toContain(label);
  expect(wrapper.text()).toContain("结构未确认");
  wrapper.unmount();
});
