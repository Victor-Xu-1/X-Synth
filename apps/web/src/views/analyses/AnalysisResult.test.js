import { mount, flushPromises } from "@vue/test-utils";
import { acceptsProcess } from "@/views/process/process-form";
import AnalysisResult from "./AnalysisResult.vue";
jest.mock("@/components/SmilesImage.vue", () => ({ props: ["smiles"], template: '<span class="structure-identity">{{ smiles }}</span>' }));
jest.mock("@/views/assessment/AssessmentResults.vue", () => ({ props: ["result"], template: '<div class="assessment" />' }));
jest.mock("@/views/process/ProcessResults.vue", () => ({ props: ["result"], render() {
  if (this.result.brokenRenderer) throw new Error("renderer contract gap");
  return require("vue").h("div", { class: "process" });
} }));
jest.mock("@/views/process/process-form", () => ({ acceptsProcess: jest.fn().mockReturnValue(false) }));
jest.mock("@/views/optimization/RecommendationTable.vue", () => ({ props: ["result"], template: '<div class="optimization" />' }));
jest.mock("@/views/impurity/ImpurityResults.vue", () => ({ props: ["result"], template: '<div class="impurity" />' }));
jest.mock("@/views/optimization/optimization.css", () => ({}));
const setup = (kind, result) => mount(AnalysisResult, { props: { kind, result } });
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
  wrapper.unmount();
});
test("a nested renderer failure is contained and a subsequent valid result recovers", async () => {
  acceptsProcess.mockReturnValueOnce(true);
  const wrapper = setup("process", { brokenRenderer: true });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  await wrapper.setProps({ kind: "forward", result: { reactants: "", products: [] } });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("未找到");
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
  expect(forward.text()).toContain("未找到"); expect(forward.find("button").exists()).toBe(false);
  const conditions = setup("conditions", { reactants: "", product: "", conditions: [] });
  expect(conditions.text()).toContain("未返回条件候选");
  forward.unmount(); conditions.unmount();
});
