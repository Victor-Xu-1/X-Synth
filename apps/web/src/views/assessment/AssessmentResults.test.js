import { mount } from "@vue/test-utils";
import AssessmentResults from "./AssessmentResults.vue";
import { realCalculation, calculationStubs } from "./test-support";
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));

test("dedicated result retains real descriptor values, structure and source attribution", () => {
  const result = realCalculation("assessment", { smiles: "N[C@@H](C)C(=O)O" });
  const wrapper = mount(AssessmentResults, { props: { result }, global: { stubs: calculationStubs } });
  expect(wrapper.text()).toContain("SA Score"); expect(wrapper.text()).toContain("Bertz CT");
  expect(wrapper.text()).toContain("BSD-3-Clause"); expect(wrapper.text()).toContain(result.rdkit_version);
  expect(wrapper.get(".structure-identity").text()).toBe(result.structure.smiles);
  expect(wrapper.text()).toContain("不是完整路线验证"); wrapper.unmount();
});
test("multi-component salts remain separate, with undefined aggregate scores", () => {
  const result = realCalculation("assessment", { smiles: "[Na+].CC(=O)[O-]" });
  const wrapper = mount(AssessmentResults, { props: { result }, global: { stubs: calculationStubs } });
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  expect(wrapper.text()).toContain("不合并"); expect(wrapper.text()).toContain("未定义"); wrapper.unmount();
});
