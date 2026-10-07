import { mount } from "@vue/test-utils";
import { topologyFromCandidate } from "@/common/route-graph";
import RouteStepList from "./RouteStepList.vue";

jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", template: "<div />" }));
jest.mock("./RouteEvidencePanel.vue", () => ({
  name: "RouteEvidencePanel", props: ["step"], template: "<div />",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "width", "height", "showErrorImage"], template: "<div />",
}));
const wrappers = [];
const candidate = {
  route_id: "structure-contract", target_smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]",
  metadata: { forward_validation_steps: [false], forward_validation_method: "native_template_reconstruction" },
  steps: [{
    product: "[13CH3][C@H]([NH3+])CO.[Cl-]",
    precursors: ["[13CH3][C@@H](N)CO", "[Cl-]"], confidence: 0,
    source: "native record",
    metadata: { model_metadata: [{ model_score: 0 }] },
  }],
};
const graph = topologyFromCandidate(candidate);
function setup(props = {}) {
  const wrapper = mount(RouteStepList, { props: { candidate, graph, ...props }, global: { stubs: {
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled" />' },
    VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
    VIcon: true,
  } } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("structures preserve isotope, stereochemistry, charge and salt with unchanged image sizes", () => {
  const wrapper = setup();
  const images = wrapper.findAllComponents({ name: "SmilesImage" });
  expect(images.map((image) => image.props("smiles"))).toEqual([
    ...candidate.steps[0].precursors, candidate.target_smiles,
  ]);
  expect(images.map((image) => [image.props("width"), image.props("height")])).toEqual([
    [170, 100], [170, 100], [190, 110],
  ]);
  expect(images.every((image) => image.props("showErrorImage") === false)).toBe(true);
  expect(wrapper.get(".step-confidence").text()).toBe("步骤分数 0.000");
  expect(wrapper.get(".step-validation").text()).toBe("模板重构 未通过");
  expect(wrapper.getComponent({ name: "RouteEvidencePanel" }).props("step")).toEqual(candidate.steps[0]);
});

test("structure, step selection and graph location retain actual graph node IDs", async () => {
  const wrapper = setup({ selectedNode: "r-1" });
  expect(wrapper.get(".route-step").classes()).toContain("active");
  expect(wrapper.get(".step-select").attributes("aria-pressed")).toBe("true");
  await wrapper.get(".step-select").trigger("click");
  await wrapper.get(".step-product").trigger("click");
  await wrapper.get('.step-heading button[aria-label="定位步骤 1"]').trigger("click");
  expect(wrapper.emitted("select")).toEqual([["r-1"], [graph.target_id]]);
  expect(wrapper.emitted("locate")).toEqual([["r-1"]]);
});

test("missing node identities disable navigation and empty steps stay explicit", async () => {
  const wrapper = setup({ graph: { nodes: [], edges: [] } });
  expect(wrapper.get(".step-select").attributes("disabled")).toBeDefined();
  expect(wrapper.findAll(".step-molecule").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
  await wrapper.setProps({ candidate: { ...candidate, steps: [] } });
  expect(wrapper.text()).toContain("未记录反应步骤");
});
