import { mount, flushPromises } from "@vue/test-utils";
import Preview from "./ReactionRecordPreview.vue";
import { initializeLocale, setLocale, uiText } from "@/i18n";
// Labels/data are isolated here; actual depictions and zoom are verified in Chrome.
jest.mock("./StructurePreview.vue", () => ({ name: "StructurePreview", props: ["smiles", "label"],
  template: '<button :data-smiles="smiles">{{ label }}</button>' }));

const value = { reactants: [{ index: 1, smiles: "[13CH3][C@H](O)N.[Cl-]", name: "工艺核算", formula: "raw" }],
  products: [{ index: 1, smiles: "CCO", name: "", formula: "C2H6O" }],
  agents: [{ index: 1, smiles: "O", name: "研究者原始名称", formula: "H2O" }, { index: 2, smiles: "O", name: "", formula: "H2O" }] };

test("each complete compound has its own inspection surface without translating source names or losing duplicates", async () => {
  initializeLocale(null);
  const original = JSON.stringify(value);
  const wrapper = mount(Preview, { props: { value }, global: { config: { globalProperties: { $tr: uiText } } } });
  expect(wrapper.findAll("button")).toHaveLength(4);
  expect(wrapper.findAll("button").map(item => item.text())).toEqual([
    "Reactant structure 1", "Product structure 1", "Reagent structure 1", "Reagent structure 2",
  ]);
  expect(wrapper.text()).toContain("工艺核算");
  expect(wrapper.text()).not.toContain("Process accounting");
  const elements = wrapper.findAll("button").map(item => item.element);
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.findAll("button").map(item => item.element)).toEqual(elements);
  expect(wrapper.findAll("button").map(item => item.text())).toEqual(["反应物结构 1", "产物结构 1", "试剂结构 1", "试剂结构 2"]);
  expect(wrapper.findAll("button").map(item => item.attributes("data-smiles"))).toEqual([
    value.reactants[0].smiles, value.products[0].smiles, "O", "O",
  ]);
  expect(JSON.stringify(value)).toBe(original);
  wrapper.unmount();
});
