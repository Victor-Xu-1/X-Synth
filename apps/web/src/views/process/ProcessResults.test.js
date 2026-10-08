import { mount, flushPromises } from "@vue/test-utils";
import { calculationStubs, realCalculation } from "../assessment/test-support";
import { analysisResultError, readAnalysisRecord } from "@/common/analysis-records";
import { acceptsProcess } from "./process-form";
import { processMetricGroups, processMetricValue } from "./process-result-model";
import ProcessResults from "./ProcessResults.vue";

jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("@/common/api", () => ({ API: {} }));

// Real deterministic calculators supply presentation fixtures, not experimental acceptance.
const body = {
  materials: [
    { id: "limiting", name: "乙醇批次", smiles: "CCO", role: "reactant", mass: { value: 100, unit: "g" } },
    { id: "salt", name: "盐组分", smiles: "CC(=O)[O-].[Na+]", role: "reagent", mass: { value: 0, unit: "mg" } },
    { id: "chiral", name: "手性结构", smiles: "C[C@H](F)Cl", role: "auxiliary", mass: { value: 0, unit: "g" } },
    { id: "isotope", name: "同位素结构", smiles: "[13CH3]CO", role: "auxiliary", mass: { value: 0, unit: "g" } },
  ],
  product: { smiles: "CC=O", mass: { value: 20, unit: "g" }, purity_mass_percent: 80, reported_yield_percent: 0 },
  other_outputs: [{ id: "recovered", name: "回收水", smiles: "O", role: "recovered", mass: { value: 10, unit: "g" } }],
  input_boundary_complete: true,
  yield_basis: { limiting_material_id: "limiting", limiting_purity_mass_percent: 95, reactant_coefficient: 1, product_coefficient: 1 },
};
const wrappers = [];
const stubs = {
  ...calculationStubs,
  SmilesImage: { name: "SmilesImage", props: { smiles: String, allowCopy: Boolean, lazy: Boolean, showErrorImage: Boolean }, template: '<span class="structure-identity">{{ smiles }}</span>' },
};
let complete, partial;
beforeAll(() => {
  complete = realCalculation("process", body);
  partial = realCalculation("process", { ...body, input_boundary_complete: false, yield_basis: null,
    product: { ...body.product, purity_mass_percent: null } });
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

function setup(result = complete) {
  const wrapper = mount(ProcessResults, { attachTo: document.body, props: { result }, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
const tab = (wrapper, index) => wrapper.findAll('[role="tab"]')[index];
const overview = (wrapper) => wrapper.findAll('[role="tabpanel"]')[0];

test("structure identity leads the result, with four compact primary metrics and all fifteen overview metrics", () => {
  const wrapper = setup();
  expect(wrapper.get(".product-formula").text()).toBe(complete.product.structure.formula);
  expect(wrapper.get(".product-identity code").text()).toBe(complete.product.structure.smiles);
  expect(wrapper.getComponent({ name: "SmilesImage" }).props()).toMatchObject({ smiles: complete.product.structure.smiles, allowCopy: true, showErrorImage: false });
  expect(wrapper.findAll(".primary-metric")).toHaveLength(4);
  const panel = overview(wrapper);
  expect(panel.findAll(".metric-row")).toHaveLength(15);
  for (const row of processMetricGroups(complete).flatMap((group) => group.rows)) {
    expect(panel.get(`[data-metric="${row.key}"] dd`).text()).toBe(processMetricValue(row.value));
  }
  expect(panel.get('[data-metric="reported_yield_percent"]').text()).toContain("录入值");
  expect(panel.get('[data-metric="calculated_yield_percent"]').text()).toContain("计算值");
  expect(panel.get('[data-metric="pmi"] dd').text()).toBe("5");
  expect(panel.get('[data-metric="purity_corrected_pmi"] dd').text()).toBe("6.25");
  expect(panel.get('[data-metric="pure_mass_g"] dd').text()).toBe("16");
  expect(panel.get('[data-metric="reported_yield_percent"] dd').text()).toBe("0");
  expect(wrapper.find(".missing-inputs").exists()).toBe(false);
  expect(wrapper.find(".boundary-calculated").exists()).toBe(true);
});

test("partial PMI and missing purity are visible while undefined values do not become zero", () => {
  const wrapper = setup(partial);
  expect(wrapper.get('.primary-metric[data-metric="pmi_lower_bound"] dd').text()).toBe("5");
  expect(wrapper.get(".boundary-notice").text()).toContain("不能作为完整工艺 PMI");
  expect(wrapper.get(".missing-inputs").text()).toContain("缺少质量纯度");
  expect(wrapper.get(".missing-inputs").findAll("li").map((item) => item.text())).toEqual(partial.missing_inputs);
  expect(overview(wrapper).get('[data-metric="pmi"] dd').text()).toBe("未定义");
  expect(overview(wrapper).get('[data-metric="pure_mass_g"] dd').text()).toBe("未定义");
  expect(overview(wrapper).get('[data-metric="reported_yield_percent"] dd').text()).toBe("0");
});

test("zero bulk mass, purity and calculated yield remain distinct from undefined PMI", () => {
  const result = realCalculation("process", { ...body,
    product: { ...body.product, mass: { value: 0, unit: "g" }, purity_mass_percent: 0 },
  });
  const wrapper = setup(result);
  expect(wrapper.get('.primary-metric[data-metric="isolated_mass_g"] dd').text()).toBe("0");
  expect(wrapper.get('.primary-metric[data-metric="pure_mass_g"] dd').text()).toBe("0");
  expect(wrapper.get('.primary-metric[data-metric="calculated_yield_percent"] dd').text()).toBe("0");
  expect(wrapper.get('.primary-metric[data-metric="pmi"] dd').text()).toBe("未定义");
  expect(wrapper.get(".boundary-notice").text()).toContain("分母为零");
});

test("tabs have linked panels, one tab stop, pointer selection and full arrow/Home/End focus support", async () => {
  const wrapper = setup(), tabs = wrapper.findAll('[role="tab"]');
  expect(tabs.map((item) => item.text())).toEqual(["核算总览", "物料明细", "核算口径"]);
  expect(tabs.map((item) => item.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
  tabs.forEach((item) => {
    expect(wrapper.get(`#${item.attributes("aria-controls")}`).attributes("aria-labelledby")).toBe(item.attributes("id"));
  });
  tabs[0].element.focus();
  for (const [key, index] of [["ArrowRight", 1], ["ArrowRight", 2], ["ArrowRight", 0], ["ArrowLeft", 2], ["Home", 0], ["End", 2]]) {
    await wrapper.get('[role="tab"][aria-selected="true"]').trigger("keydown", { key });
    await flushPromises();
    expect(document.activeElement).toBe(tabs[index].element);
    expect(tabs[index].attributes("aria-selected")).toBe("true");
    expect(wrapper.findAll('[role="tabpanel"]').filter((panel) => panel.isVisible())).toHaveLength(1);
  }
  await tabs[2].trigger("keydown", { key: "Home", ctrlKey: true });
  expect(tabs[2].attributes("aria-selected")).toBe("true");
  await tabs[1].trigger("click");
  expect(tabs[1].attributes("tabindex")).toBe("0");
  expect(wrapper.findAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
});

test("material view retains every input/output, role, recorded unit and full canonical chemical identity", async () => {
  const wrapper = setup();
  expect(wrapper.find(".recorded-materials").exists()).toBe(false);
  await tab(wrapper, 1).trigger("click");
  const panel = wrapper.get(".recorded-materials");
  expect(panel.findAll("tbody tr")).toHaveLength(complete.materials.length + complete.other_outputs.length);
  for (const row of [...complete.materials, ...complete.other_outputs]) {
    const material = panel.get(`[data-material-id="${row.id}"]`);
    expect(material.text()).toContain(row.name);
    expect(material.text()).toContain(row.role_label);
    expect(material.get("code").text()).toBe(row.structure.smiles);
    expect(material.getComponent({ name: "SmilesImage" }).props()).toMatchObject({ smiles: row.structure.smiles, lazy: true, allowCopy: true, showErrorImage: false });
  }
  expect(panel.get('[data-material-id="salt"]').text()).toContain("0 mg");
  expect(panel.findAll("input, textarea, select, iframe")).toHaveLength(0);
});

test("unknown material identity and missing mass stay unknown, with no synthetic preview", async () => {
  const result = realCalculation("process", { ...body, yield_basis: null,
    materials: [{ ...body.materials[0], smiles: null, mass: { value: null, unit: "kg" } }], other_outputs: [],
  });
  const wrapper = setup(result);
  await tab(wrapper, 1).trigger("click");
  const row = wrapper.get("tbody tr");
  expect(row.text()).toContain("结构未提供");
  expect(row.find(".structure-identity").exists()).toBe(false);
  expect(row.findAll("td").map((cell) => cell.text())).toEqual(["反应物", "未定义 kg", "未定义", "未定义"]);
  expect(wrapper.get(".recorded-materials").text()).toContain("未记录其他出料");
});

test("basis view preserves declared stoichiometry, every source notice, RDKit and safe ACS reference", async () => {
  const wrapper = setup(), snapshot = JSON.stringify(complete);
  await tab(wrapper, 2).trigger("click");
  const basis = wrapper.get(".process-basis");
  expect(basis.text()).toContain("乙醇批次");
  expect(basis.text()).toContain("95");
  expect(basis.text()).toContain("1 : 1");
  expect(basis.text()).toContain("已声明投料边界完整");
  expect(basis.get("code").text()).toBe(complete.materials[0].structure.smiles);
  expect(basis.findAll(".process-notices li").map((item) => item.text())).toEqual(complete.notices);
  const reference = basis.get(".process-reference a");
  expect(reference.attributes()).toMatchObject({ href: complete.pmi_reference_url, target: "_blank", rel: "noopener noreferrer" });
  expect(basis.get(".process-reference").text()).toContain(`RDKit ${complete.rdkit_version}`);
  expect(JSON.stringify(complete)).toBe(snapshot);
});

test("missing yield basis and unsafe reference never become implied chemistry or an executable link", async () => {
  const wrapper = setup({ ...partial, pmi_reference_url: "javascript:alert(1)" });
  await tab(wrapper, 2).trigger("click");
  expect(wrapper.get(".process-basis").text()).toContain("摩尔收率未定义");
  expect(wrapper.get(".process-reference").find("a").exists()).toBe(false);
});

test.each([null, undefined, "b".repeat(32)])("saved native outputs with optional record id %p remain read-only and render", async (record_id) => {
  const result = JSON.parse(JSON.stringify({ ...complete, record_id }));
  const record = readAnalysisRecord({ id: "saved", kind: "process", status: "completed", created: "2026-10-08T00:00:00Z", inputs: body, result }, "saved");
  expect(analysisResultError(record.kind, record.result, acceptsProcess)).toBe("");
  const wrapper = setup(record.result);
  expect(overview(wrapper).get('[data-metric="pmi"] dd').text()).toBe("5");
  expect(wrapper.find(".analysis-record-link").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("查看本次记录");
  await tab(wrapper, 2).trigger("click");
  await wrapper.setProps({ result: partial });
  expect(tab(wrapper, 0).attributes("aria-selected")).toBe("true");
  expect(wrapper.find(".analysis-record-link").exists()).toBe(false);
  expect(wrapper.find(".boundary-lower_bound").exists()).toBe(true);
});

test("multiple result instances have independent tabs and unique accessible ids", async () => {
  const host = mount({ components: { ProcessResults }, data: () => ({ result: complete }),
    template: '<ProcessResults :result="result" /><ProcessResults :result="result" />',
  }, { attachTo: document.body, global: { stubs } });
  wrappers.push(host);
  const [first, second] = host.findAllComponents(ProcessResults);
  expect(tab(first, 0).attributes("id")).not.toBe(tab(second, 0).attributes("id"));
  await tab(first, 1).trigger("click");
  expect(tab(second, 0).attributes("aria-selected")).toBe("true");
});

test("the maximum recorded input/output rows remain available without editors or truncation", async () => {
  const result = realCalculation("process", { ...body, yield_basis: null,
    materials: Array.from({ length: 50 }, (_, index) => ({ ...body.materials[0], id: `input-${index}`, mass: { value: index ? 0 : 100, unit: "g" } })),
    other_outputs: Array.from({ length: 50 }, (_, index) => ({ ...body.other_outputs[0], id: `output-${index}`, mass: { value: index ? 0 : 10, unit: "g" } })),
  });
  const wrapper = setup(result);
  await tab(wrapper, 1).trigger("click");
  expect(wrapper.findAll("tbody tr")).toHaveLength(100);
  expect(wrapper.findAll("tbody .structure-identity")).toHaveLength(100);
  expect(wrapper.findAll("input, textarea, select, iframe")).toHaveLength(0);
});
