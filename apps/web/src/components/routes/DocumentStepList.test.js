import { mount, flushPromises } from "@vue/test-utils";
import DocumentStepList from "./DocumentStepList.vue";
import { documentStepDetails } from "@/common/document-step-details";
import { setLocale } from "@/i18n";

jest.mock("../workspace/StructurePreview.vue", () => ({ name: "StructurePreview", props: ["label", "smiles", "height"], template: '<div class="preview-record" :data-smiles="smiles" />' }));
beforeEach(() => setLocale("en", { persist: false }));

const graph = { nodes: [
  { id: "a", type: "molecule", smiles: "[13CH3][C@H](O)Cl.[Na+]" },
  { id: "b", type: "molecule", smiles: "[13CH3][C@H](O)Cl.[Na+]" },
  { id: "r", type: "reaction", label: "产物", note: "Raw ELN note 31.5 mg" },
  { id: "p", type: "molecule", smiles: "[13CH3][C@H](O)O" },
], edges: [
  { id: "ea", source: "a", target: "r", input_occurrences: 498 },
  { id: "eb", source: "b", target: "r" }, { id: "ep", source: "r", target: "p" },
] };
const stubs = {
  VLazy: { template: '<div class="lazy-scheme"><slot /></div>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VBtn: { template: '<button><slot /></button>' }, VIcon: true,
  StructurePreview: { name: "StructurePreview", props: ["label", "smiles", "height"], template: '<div class="preview-record" :data-smiles="smiles" />' },
};

test("saved steps keep source labels, distinct equal structures and occurrence counts without repeated images", async () => {
  const before = JSON.stringify(graph);
  const wrapper = mount(DocumentStepList, { props: { steps: documentStepDetails(graph) }, global: { stubs } });
  expect(wrapper.get(".document-step-name").text()).toBe("产物");
  expect(wrapper.get(".document-step-note").text()).toBe("Raw ELN note 31.5 mg");
  expect(wrapper.findAll("figure").map(item => item.attributes("data-edge-id"))).toEqual(["ea", "eb"]);
  expect(wrapper.findAllComponents({ name: "StructurePreview" }).map(item => item.props("smiles")))
    .toEqual([graph.nodes[0].smiles, graph.nodes[1].smiles, graph.nodes[3].smiles]);
  expect(wrapper.get("figcaption").text()).toBe("Input structure records ×498");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.get("figcaption").text()).toBe("输入结构记录 ×498");
  expect(wrapper.get(".document-step-name").text()).toBe("产物");
  expect(JSON.stringify(graph)).toBe(before);
  wrapper.unmount();
});

test.each(["select", "locate"])("%s forwards the native activation synchronously and keeps its original reaction ID", async action => {
  const wrapper = mount(DocumentStepList, { props: { steps: documentStepDetails(graph), selectedNode: "r" }, global: { stubs } });
  const button = wrapper.get(action === "select" ? ".document-step-select" : '[aria-label="Locate step 1"]');
  const event = new MouseEvent("click", { bubbles: true, detail: 0 });
  button.element.dispatchEvent(event); await flushPromises();
  expect(wrapper.emitted(action)[0][0]).toBe("r");
  expect(wrapper.emitted(action)[0][1]).toBe(event);
  expect(wrapper.get(".document-step-select").attributes("aria-pressed")).toBe("true");
  wrapper.unmount();
});

test("incomplete draft steps expose missing sides, not manufactured products or conditions", () => {
  const wrapper = mount(DocumentStepList, { props: { steps: documentStepDetails({ nodes: [{ id: "r", type: "reaction" }], edges: [] }) }, global: { stubs } });
  expect(wrapper.text()).toContain("Reactants not connected");
  expect(wrapper.text()).toContain("Product not connected");
  expect(wrapper.findAllComponents({ name: "StructurePreview" })).toHaveLength(0);
  wrapper.unmount();
});

test("a target-only document has no invented synthesis step", () => {
  const wrapper = mount(DocumentStepList, { global: { stubs } });
  expect(wrapper.text()).toContain("Reaction steps not recorded");
  expect(wrapper.findAll("article")).toHaveLength(0);
  wrapper.unmount();
});
