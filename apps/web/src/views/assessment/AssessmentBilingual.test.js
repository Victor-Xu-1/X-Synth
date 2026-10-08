import { flushPromises, mount } from "@vue/test-utils";
import { randomUUID } from "node:crypto";
import { initializeLocale, setLocale } from "@/i18n";
import AssessmentResults from "./AssessmentResults.vue";

jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles"], template: '<code class="structure-identity">{{ smiles }}</code>',
}));

const wrappers = [], hosts = [];
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// Presentation-only DTO: no calculation, provider or scientific acceptance is exercised here.
const result = freeze({
  scope: "molecular_descriptors_only", rdkit_version: "recorded-version", record_id: "a".repeat(32),
  structure: {
    smiles: "[13CH3][C@H](F)C(=O)[O-].[Na+]", formula: "C3H4FNaO2",
    molecular_weight_g_mol: 115.04, exact_mass_da: 115.01, components: 2, formal_charge: 0, atoms: 7, heavy_atoms: 7,
  },
  descriptors: {
    h_bond_donors: 0, h_bond_acceptors: 2, tpsa_angstrom2: 40.13, logp_crippen: -1.25,
    rotatable_bonds: 1, rings: 0, aromatic_rings: 0, fraction_csp3: 0.667,
    potential_stereocenters: 1, unassigned_stereocenters: 0,
  },
  components: [
    { index: 1, structure: { smiles: "[13CH3][C@H](F)C(=O)[O-]", formula: "C3H4FO2", molecular_weight_g_mol: 92.05, exact_mass_da: 92.02, components: 1, formal_charge: -1, atoms: 6, heavy_atoms: 6 },
      metrics: { sa_score: 2.34, sps: 22, nsps: 3.667, bertz_ct: 41.45 }, notices: ["未经收录的原始说明"] },
    { index: 2, structure: { smiles: "[Na+]", formula: "Na+", molecular_weight_g_mol: 22.99, exact_mass_da: 22.99, components: 1, formal_charge: 1, atoms: 1, heavy_atoms: 1 },
      metrics: { sa_score: null, sps: 0, nsps: 0, bertz_ct: 0 }, notices: ["非含碳组分：不提供药物样分子的 SA Score。"] },
  ],
  notices: ["Crippen logP 为计算描述符，不是实测溶解度。", "原始结果里的自定义说明"],
  methods: [{ name: "方法与来源", implementation: "original/path.py", license: "许可", reference_url: "https://example.org/method", source_url: "https://example.org/source" }],
});

beforeAll(() => Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID }));
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});
function render() {
  initializeLocale(null);
  const host = document.createElement("div"); document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(AssessmentResults, { attachTo: host, props: { result }, global: { stubs: { VIcon: true } } });
  wrappers.push(wrapper); return wrapper;
}
async function select(wrapper, index) {
  await wrapper.findAll('[role="tab"]')[index].trigger("click");
  await flushPromises();
}

test("English descriptor labels and boundaries do not translate or modify scientific records", async () => {
  const before = JSON.stringify(result), wrapper = render();
  expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(["Core facts", "Component complexity", "Complete descriptors", "Methods and provenance"]);
  expect(wrapper.get('.full-identity [data-field="atoms"] dt').text()).toBe("Molecular-graph atom count");
  expect(wrapper.get('.full-identity [data-field="atoms"] dd').text()).toBe("7");
  expect(wrapper.get(".full-identity code").text()).toBe(result.structure.smiles);
  expect(wrapper.get(".assessment-notices").text()).toContain("not measured solubility");
  expect(wrapper.get(".assessment-notices").text()).toContain("原始结果里的自定义说明");
  expect(wrapper.get(".assessment-notices").text()).toContain("未经收录的原始说明");
  await select(wrapper, 1);
  expect(wrapper.get('[data-component-index="2"] [data-metric="sa_score"]').text()).toBe("Undefined");
  expect(wrapper.get('[data-component-index="2"] [data-metric="sps"]').text()).toBe("0");
  expect(wrapper.get('[data-component-index="1"] code').text()).toBe(result.components[0].structure.smiles);
  const selectedTab = wrapper.findAll('[role="tab"]')[1], table = wrapper.get("table");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get('[data-section="components"]').isVisible()).toBe(true);
  expect(selectedTab.attributes("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(selectedTab.element);
  expect(wrapper.get("table").element).toBe(table.element);
  expect(wrapper.get('[data-component-index="2"] [data-metric="sa_score"]').text()).toBe("未定义");
  expect(wrapper.get('[data-component-index="2"] [data-metric="sps"]').text()).toBe("0");
  expect(wrapper.get('.full-identity [data-field="atoms"] dt').text()).toBe("结构图原子数");
  expect(JSON.stringify(result)).toBe(before);
});

test("method names, licences, URLs, scope and identifiers remain literal across language switches", async () => {
  const wrapper = render();
  await select(wrapper, 3);
  expect(wrapper.get(".method-row h3").text()).toBe("方法与来源");
  expect(wrapper.get(".method-row dl").text()).toContain("许可");
  expect(wrapper.get(".method-context").text()).toContain(result.record_id);
  expect(wrapper.get(".method-context").text()).toContain(result.scope);
  const link = wrapper.get('a[href="https://example.org/method"]');
  expect(link.attributes("rel")).toBe("noopener noreferrer");
  const before = JSON.stringify(result), selected = wrapper.findAll('[role="tab"]')[3];
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get(".method-row h3").text()).toBe("方法与来源");
  expect(wrapper.get('a[href="https://example.org/method"]').element).toBe(link.element);
  expect(wrapper.get('[data-section="methods"]').isVisible()).toBe(true);
  expect(document.activeElement).toBe(selected.element);
  expect(JSON.stringify(result)).toBe(before);
});
