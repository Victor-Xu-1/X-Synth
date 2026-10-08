import { flushPromises, mount } from "@vue/test-utils";
import { randomUUID } from "node:crypto";
import AssessmentResults from "./AssessmentResults.vue";
import WorkbenchTabs from "@/components/WorkbenchTabs.vue";
import { metricValue } from "./result-model";
import { realCalculation, calculationStubs } from "./test-support";
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));

const results = {}, wrappers = [], hosts = [];
const tabs = ["核心事实", "组分复杂度", "完整描述符", "方法与来源"];
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
  const inputs = {
    chiral: "N[C@@H](C)C(=O)O", salt: "[Na+].CC(=O)[O-]", unassigned: "CC(F)Cl",
    hydrogen: "[2H][2H]", isotopeSalt: "[13CH3][C@H](F)C(=O)[O-].[Na+]",
  };
  Object.entries(inputs).forEach(([key, smiles]) => {
    results[key] = freeze(realCalculation("assessment", { smiles }));
  });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});
function render(result = results.chiral) {
  const host = document.createElement("div"); document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(AssessmentResults, { attachTo: host, props: { result }, global: { stubs: calculationStubs } });
  wrappers.push(wrapper); return wrapper;
}
async function select(wrapper, title) {
  const tab = wrapper.findAll('[role="tab"]').find((item) => item.text() === title);
  expect(tab).toBeDefined(); await tab.trigger("click"); await flushPromises();
  return wrapper.get(`[id="${tab.attributes("aria-controls")}"]`);
}

test("complete identity and core facts lead the real shared reading tabs without a redundant record self-link", () => {
  const result = freeze({ ...results.chiral, record_id: "a".repeat(32) });
  const wrapper = render(result);
  expect(wrapper.findComponent(WorkbenchTabs).exists()).toBe(true);
  expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(tabs);
  expect(wrapper.findAll('[role="tabpanel"]').filter((panel) => panel.isVisible())).toHaveLength(1);
  expect(wrapper.get('[data-section="overview"]').isVisible()).toBe(true);
  expect(wrapper.get(".full-identity code").text()).toBe(result.structure.smiles);
  expect(wrapper.get(".structure-identity").text()).toBe(result.structure.smiles);
  expect(wrapper.get(".full-identity").text()).toContain(result.structure.formula);
  expect(wrapper.find(".analysis-record-link").exists()).toBe(false);
  expect(wrapper.find(".complexity-table").exists()).toBe(false);
  expect(wrapper.find(".method-row").exists()).toBe(false);
});

test("single-component core complexity and physicochemical facts are direct actual RDKit fields", () => {
  const wrapper = render(), panel = wrapper.get('[data-section="overview"]');
  Object.entries(results.chiral.components[0].metrics).forEach(([key, value]) => {
    expect(panel.get(`[data-metric="${key}"] dd`).text()).toBe(metricValue(value));
  });
  ["logp_crippen", "tpsa_angstrom2", "h_bond_donors", "h_bond_acceptors", "rotatable_bonds", "fraction_csp3"].forEach((key) => {
    expect(panel.get(`[data-metric="${key}"] dd`).text()).toBe(metricValue(results.chiral.descriptors[key]));
  });
});

test("all twelve descriptors and complete structure facts retain original values and units", async () => {
  const wrapper = render(), result = results.chiral;
  ["molecular_weight_g_mol", "exact_mass_da", "formal_charge", "atoms", "heavy_atoms", "components"].forEach((key) => {
    expect(wrapper.get(`.full-identity [data-field="${key}"] dd`).text()).toBe(metricValue(result.structure[key]));
  });
  const panel = await select(wrapper, "完整描述符");
  expect(panel.findAll("[data-metric]")).toHaveLength(12);
  const values = { exact_mass_da: result.structure.exact_mass_da, heavy_atoms: result.structure.heavy_atoms, ...result.descriptors };
  Object.entries(values).forEach(([key, value]) => {
    expect(panel.get(`[data-metric="${key}"] dd`).text()).toBe(metricValue(value));
  });
  expect(panel.text()).toContain("Å²"); expect(panel.text()).toContain("Da");
  expect(panel.text()).toContain("Crippen logP（计算值）");
});

test.each(["salt", "unassigned", "hydrogen"])("all scientific and component notices remain visible in every reading layer: %s", async (key) => {
  const result = results[key], wrapper = render(result);
  for (const title of tabs) {
    await select(wrapper, title);
    const notices = wrapper.get(".assessment-notices"); expect(notices.isVisible()).toBe(true);
    [...result.notices, ...result.components.flatMap((component) => component.notices)].forEach((notice) => {
      expect(notices.text()).toContain(notice);
    });
  }
  if (key === "unassigned") {
    expect(wrapper.get('.full-identity [data-field="unassigned_stereocenters"] dd').text()).toBe("1");
    expect(wrapper.get(".full-identity code").text()).not.toContain("@");
  }
});

test("multi-component salts keep separate complexity and every component identity, never aggregate SA", async () => {
  const wrapper = render(results.salt), overview = wrapper.get('[data-section="overview"]');
  expect(overview.find('[data-metric="sa_score"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("不合并");
  const panel = await select(wrapper, "组分复杂度");
  expect(panel.findAll("tbody tr")).toHaveLength(2);
  results.salt.components.forEach((component) => {
    const row = panel.get(`[data-component-index="${component.index}"]`);
    expect(row.get("code").text()).toBe(component.structure.smiles);
    Object.entries(component.metrics).forEach(([key, value]) => {
      expect(row.get(`[data-metric="${key}"]`).text()).toBe(metricValue(value));
    });
    ["molecular_weight_g_mol", "exact_mass_da", "formal_charge", "atoms", "heavy_atoms", "components"].forEach((key) => {
      expect(row.get(`[data-field="${key}"] dd`).text()).toBe(metricValue(component.structure[key]));
    });
  });
});

test("a real hydrogen-only component retains raw SPS, zero Bertz and undefined SA/nSPS", async () => {
  const wrapper = render(results.hydrogen), panel = await select(wrapper, "组分复杂度");
  const row = panel.get('[data-component-index="1"]');
  expect(row.get('[data-metric="sps"]').text()).toBe(metricValue(results.hydrogen.components[0].metrics.sps));
  expect(row.get('[data-metric="bertz_ct"]').text()).toBe("0");
  expect(row.get('[data-metric="nsps"]').text()).toBe("未定义");
  expect(row.get('[data-metric="sa_score"]').text()).toBe("未定义");
});

test("isotope, specified stereo, charge and salt identities are never rewritten by reading navigation", async () => {
  const result = results.isotopeSalt, before = JSON.stringify(result), wrapper = render(result);
  expect(wrapper.get(".full-identity code").text()).toBe(result.structure.smiles);
  expect(result.structure.smiles).toContain("[13CH3]"); expect(result.structure.smiles).toContain("@");
  expect(result.structure.smiles).toContain("[Na+]"); expect(result.structure.smiles).toContain("[O-]");
  await select(wrapper, "组分复杂度"); await select(wrapper, "方法与来源"); await select(wrapper, "核心事实");
  expect(wrapper.get(".full-identity code").text()).toBe(result.structure.smiles);
  expect(JSON.stringify(result)).toBe(before);
});

test("the methods layer preserves actual RDKit scope/version, implementations, references and licenses", async () => {
  const wrapper = render(), panel = await select(wrapper, "方法与来源");
  expect(panel.text()).toContain(results.chiral.scope); expect(panel.text()).toContain(results.chiral.rdkit_version);
  const rows = panel.findAll(".method-row"); expect(rows).toHaveLength(results.chiral.methods.length);
  results.chiral.methods.forEach((method, index) => {
    expect(rows[index].text()).toContain(method.name); expect(rows[index].text()).toContain(method.implementation);
    expect(rows[index].text()).toContain(method.license);
    expect(rows[index].findAll("a").map((link) => link.attributes("href"))).toEqual([method.reference_url, method.source_url]);
    rows[index].findAll("a").forEach((link) => expect(link.attributes("rel")).toBe("noopener noreferrer"));
  });
});

test("record metadata remains readable without recreating a link to the open record", async () => {
  const result = freeze({ ...results.chiral, record_id: "a".repeat(32) }), wrapper = render(result);
  const panel = await select(wrapper, "方法与来源");
  expect(panel.get(".method-context").text()).toContain(result.record_id);
  expect(panel.get(".method-context").text()).toContain(result.rdkit_version);
  expect(wrapper.find(".analysis-record-link").exists()).toBe(false);
});

test("untrusted protocol source URLs cannot become executable links or suppress license attribution", async () => {
  const method = { ...results.chiral.methods[0], reference_url: "javascript:alert(1)", source_url: "data:text/html,unsafe" };
  const result = freeze({ ...results.chiral, methods: [method] }), wrapper = render(result);
  const panel = await select(wrapper, "方法与来源");
  expect(panel.find(".method-row a").exists()).toBe(false);
  expect(panel.text()).toContain(method.license); expect(panel.text()).toContain(method.implementation);
  expect(panel.text()).toContain("方法来源未提供"); expect(panel.text()).toContain("实现链接未提供");
});

test("shared tabs link stable hidden panels and provide one tab stop with actual keyboard selection/focus", async () => {
  const wrapper = render(), other = render(results.salt);
  const ids = [...wrapper.findAll('[role="tab"], [role="tabpanel"]'), ...other.findAll('[role="tab"], [role="tabpanel"]')]
    .map((item) => item.attributes("id"));
  expect(new Set(ids).size).toBe(ids.length);
  wrapper.findAll('[role="tab"]').forEach((tab) => {
    const panel = document.getElementById(tab.attributes("aria-controls"));
    const selected = tab.attributes("aria-selected") === "true";
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.attributes("id"));
    expect(panel.getAttribute("aria-hidden")).toBe(String(!selected));
    expect(panel.hasAttribute("inert")).toBe(!selected);
    expect(panel.getAttribute("tabindex")).toBe(selected ? "0" : "-1");
  });
  expect(wrapper.findAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  const first = wrapper.get('[role="tab"]'); first.element.focus();
  await first.trigger("keydown", { key: "ArrowRight" }); await flushPromises();
  expect(wrapper.get('[data-section="components"]').isVisible()).toBe(true);
  expect(document.activeElement).toBe(wrapper.get('[aria-selected="true"]').element);
  await wrapper.get('[aria-selected="true"]').trigger("keydown", { key: "End" }); await flushPromises();
  expect(wrapper.get('[data-section="methods"]').isVisible()).toBe(true);
  expect(wrapper.findAll('[role="tabpanel"]').filter((panel) => panel.isVisible())).toHaveLength(1);
});

test("a replacement record resets reading scope and cancels queued focus from the previous result", async () => {
  const wrapper = render(), oldTab = wrapper.findAll('[role="tab"]')[3];
  const focus = jest.spyOn(oldTab.element, "focus");
  oldTab.element.click(); await wrapper.setProps({ result: results.salt }); await flushPromises();
  expect(wrapper.get('[data-section="overview"]').isVisible()).toBe(true);
  expect(wrapper.get(".full-identity code").text()).toBe(results.salt.structure.smiles);
  expect(oldTab.element.isConnected).toBe(false); expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});
