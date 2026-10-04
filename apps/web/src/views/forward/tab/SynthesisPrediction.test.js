import { mount } from "@vue/test-utils";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import SynthesisPrediction from "./SynthesisPrediction.vue";

jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles"], template: '<span class="product-structure">{{ smiles }}</span>',
}));
const rows = [
  { product: "CC=O", log_probability: -2.5, feasibility_score: 0 },
  { product: "CCO", log_probability: -0.5, feasibility_score: 0.8 },
];
const prediction = {
  model: "graph2smiles_uspto_stereo", asset_identity: "a".repeat(64),
  reactants: "CCO", record_id: "unit-forward-record",
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(SynthesisPrediction, { props, global: { stubs: {
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
    VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
    VIcon: true, VProgressLinear: true,
  } } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => saveAs.mockClear());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("preserves server ordering and distinct scores, including zero", () => {
  const wrapper = setup({ results: rows, prediction });
  expect(wrapper.findAll(".product-structure").map((item) => item.text())).toEqual(["CC=O", "CCO"]);
  expect(wrapper.get("tbody").text()).toContain("-2.5000");
  expect(wrapper.get("tbody").text()).toContain("0.0000");
  expect(wrapper.get("thead").text()).toContain("序列对数评分");
  expect(wrapper.get("thead").text()).toContain("反应模型评分（FF）");
  expect(wrapper.text()).not.toMatch(/概率|验证通过|实验|杂质/);
  expect(wrapper.get('.forward-table-scroll').attributes("tabindex")).toBe("0");
});
test("pending cannot display old rows or old record links", () => {
  const wrapper = setup({ results: rows, prediction, pending: 1 });
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.find('[data-cy="forward-record-link"]').exists()).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toContain("计算产物候选");
});
test("unrun, completed-empty, and failed results remain distinct with empty history links", async () => {
  const wrapper = setup();
  expect(wrapper.text()).toContain("暂无产物候选");
  await wrapper.setProps({ prediction, submitted: true });
  expect(wrapper.text()).toContain("未返回产物候选");
  expect(wrapper.get('[data-cy="forward-record-link"]').attributes("to")).toBe("/analyses/unit-forward-record");
  await wrapper.setProps({ error: "failed", prediction: null });
  expect(wrapper.text()).toContain("产物预测未完成");
});
test("nonfinite fields are never rendered as numbers", () => {
  const wrapper = setup({ results: [{ ...rows[0], log_probability: -Infinity, feasibility_score: NaN }] });
  expect(wrapper.text()).not.toMatch(/Infinity|NaN/);
  expect(wrapper.get("tbody").text()).toContain("未提供");
});
test("CSV export uses the actual field names and retains server ordering", async () => {
  const wrapper = setup({ results: rows, prediction });
  await wrapper.get('[aria-label="导出产物候选"]').trigger("click");
  expect(saveAs).toHaveBeenCalledTimes(1);
  const [blob, name] = saveAs.mock.calls[0];
  expect(name).toBe("forward.csv");
  const csv = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  const parsed = Papa.parse(csv, { header: true }).data;
  expect(parsed.map((row) => row.product)).toEqual(["CC=O", "CCO"]);
  expect(parsed[0].log_probability).toBe("-2.5");
  expect(parsed[0].feasibility_score).toBe("0");
});
test("implementation identity is only in collapsed details", () => {
  const wrapper = setup({ results: rows, prediction });
  expect(wrapper.get("details").attributes("open")).toBeUndefined();
  expect(wrapper.get("details").text()).toContain("graph2smiles_uspto_stereo");
});
