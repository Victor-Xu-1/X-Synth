import { mount } from "@vue/test-utils";
import { topologyFromCandidate } from "@/common/route-graph";
import RouteStepList from "./RouteStepList.vue";

jest.mock("./RouteGraph.vue", () => ({ name: "RouteGraph", template: "<div />" }));
jest.mock("./RouteEvidencePanel.vue", () => ({
  name: "RouteEvidencePanel", props: ["step"], template: "<div />",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "inputType", "width", "height", "showErrorImage"],
  template: '<div class="test-drawing"><button class="drawing-retry" aria-label="retry drawing" /></div>',
}));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
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
    VLazy: { template: '<div><slot /></div>' },
    VIcon: true,
    VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  } } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("larger bounded drawings preserve isotope, stereochemistry, charge, salt and source scores", () => {
  const wrapper = setup();
  const images = wrapper.findAllComponents({ name: "SmilesImage" });
  expect(images.map((image) => image.props("smiles"))).toEqual([
    ...candidate.steps[0].precursors, candidate.target_smiles,
  ]);
  expect(images.map((image) => [image.props("width"), image.props("height")])).toEqual([
    [320, 200], [320, 200], [320, 200],
  ]);
  expect(images.every((image) => image.props("showErrorImage") === false)).toBe(true);
  expect(wrapper.get(".step-confidence").text()).toBe("步骤分数 0.000");
  expect(wrapper.get(".step-validation").text()).toBe("模板重构 未通过");
  expect(wrapper.getComponent({ name: "RouteEvidencePanel" }).props("step")).toEqual(candidate.steps[0]);
});

test("each compound exposes a separate magnify action without nesting drawing retry inside selection", async () => {
  const wrapper = setup();
  expect(wrapper.findAll(".step-structure-enlarge")).toHaveLength(3);
  expect(wrapper.find("button button").exists()).toBe(false);
  await wrapper.get(".drawing-retry").trigger("click");
  expect(wrapper.emitted("select")).toBeUndefined();
});

test("direct product enlargement uses the exact thumbnail SMILES without selecting or changing the route", async () => {
  const before = JSON.stringify(candidate), wrapper = setup();
  await wrapper.get(".step-compound-product .step-structure-enlarge").trigger("click");
  const product = wrapper.findAllComponents({ name: "RouteStepStructure" }).find(item => item.props("product"));
  const viewer = product.getComponent({ name: "StructureDrawingDialog" });
  expect(viewer.props("smiles")).toBe(candidate.target_smiles);
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
  expect(wrapper.emitted("select")).toBeUndefined();
  expect(JSON.stringify(candidate)).toBe(before);
});

test("equal precursor occurrences remain separate labelled figures with original evidence", () => {
  const smiles = candidate.steps[0].precursors[0];
  const repeated = { ...candidate, steps: [{ ...candidate.steps[0], precursors: [smiles, smiles] }] };
  const wrapper = setup({ candidate: repeated, graph: topologyFromCandidate(repeated) });
  const images = wrapper.findAllComponents({ name: "SmilesImage" });
  expect(images.map(image => image.props("smiles"))).toEqual([smiles, smiles, repeated.target_smiles]);
  expect(wrapper.getComponent({ name: "RouteEvidencePanel" }).props("step")).toEqual(repeated.steps[0]);
  expect(wrapper.findAll(".step-precursors .step-molecule").map(button => button.attributes("aria-label"))).toEqual([
    "查看步骤 1反应物 1", "查看步骤 1反应物 2",
  ]);
});

test("structure, step selection and graph location retain actual graph node IDs", async () => {
  const wrapper = setup({ selectedNode: "r-1" });
  expect(wrapper.get(".route-step").classes()).toContain("active");
  expect(wrapper.get(".step-select").attributes("aria-pressed")).toBe("true");
  await wrapper.get(".step-select").trigger("click");
  await wrapper.get(".step-product").trigger("click");
  await wrapper.get('.step-heading button[aria-label="定位步骤 1"]').trigger("click");
  expect(wrapper.emitted("select").map(([id]) => id)).toEqual(["r-1", graph.target_id]);
  expect(wrapper.emitted("locate")).toEqual([["r-1"]]);
});

test.each([".step-select", ".step-product", ".step-precursors .step-molecule"])(
  "%s forwards native activation intent without changing its node identity", (selector) => {
    const wrapper = setup();
    const button = wrapper.get(selector);
    const pointer = new MouseEvent("click", { bubbles: true, detail: 1 });
    const keyboard = new MouseEvent("click", { bubbles: true, detail: 0 });
    button.element.dispatchEvent(pointer);
    button.element.dispatchEvent(keyboard);
    const selected = wrapper.emitted("select");
    expect(selected.map(([id]) => id)).toEqual([
      button.attributes("data-node-id"), button.attributes("data-node-id"),
    ]);
    expect(selected[0][1] === pointer).toBe(true);
    expect(selected[1][1] === keyboard).toBe(true);
  },
);

test("missing node identities disable navigation and empty steps stay explicit", async () => {
  const wrapper = setup({ graph: { nodes: [], edges: [] } });
  expect(wrapper.get(".step-select").attributes("disabled")).toBeDefined();
  expect(wrapper.findAll(".step-molecule").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
  await wrapper.setProps({ candidate: { ...candidate, steps: [] } });
  expect(wrapper.text()).toContain("未记录反应步骤");
});
