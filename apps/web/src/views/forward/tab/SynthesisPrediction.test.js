import { mount } from "@vue/test-utils";
import { saveAs } from "file-saver";
import Papa from "papaparse";
import SynthesisPrediction from "./SynthesisPrediction.vue";
import { rankedForwardFixture, incompleteForwardFixture, leadingIncompleteForwardFixture } from "@/common/forward-result.test-support";
import { setLocale } from "@/i18n";

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

test("FF promotion keeps decoder 2 and joint 1 in separate concise columns in EN and CN", async () => {
  const value = rankedForwardFixture(), before = JSON.stringify(value);
  const wrapper = setup({ prediction: value, results: value.products });
  expect(wrapper.get(".forward-product-table tbody tr").findAll("td, th").slice(0, 2).map((cell) => cell.text())).toEqual(["2", "1"]);
  expect(wrapper.get(".forward-product-table thead").text()).toContain("模型排名");
  expect(wrapper.get(".forward-product-table thead").text()).toContain("联合排名");
  setLocale("en", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.get(".forward-product-table thead").text()).toContain("Model rank");
  expect(wrapper.get(".forward-product-table thead").text()).toContain("Joint rank");
  expect(wrapper.get(".forward-product-table").text()).not.toMatch(/reliability|success rate|experimentally/);
  expect(JSON.stringify(value)).toBe(before);
});

test("legacy displays recorded joint order without suggesting model or native ranks in either language", async () => {
  const wrapper = setup({ results: rows, prediction }), before = JSON.stringify(rows);
  expect(wrapper.get('[role="note"]').text()).toBe("原生排名未记录；按已保存的联合顺序显示。");
  expect(wrapper.findAll(".forward-product-table tbody tr td:first-child").map((cell) => cell.text())).toEqual(["未记录", "未记录"]);
  setLocale("en", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.get('[role="note"]').text()).toBe("Native rank not recorded; saved joint order.");
  expect(wrapper.findAll(".forward-product-table tbody th").map((cell) => cell.text())).toEqual(["1", "2"]);
  expect(JSON.stringify(rows)).toBe(before);
});

test("run details retain the complete ledger beyond the 10 displayed candidates and both assets", () => {
  const value = rankedForwardFixture(), wrapper = setup({ prediction: value, results: value.products });
  expect(wrapper.findAll(".forward-product-table tbody tr")).toHaveLength(10);
  expect(wrapper.findAll(".forward-ledger-table tbody tr")).toHaveLength(30);
  expect(wrapper.get(".forward-ledger-table tbody tr:last-child").findAll("td, th").slice(0, 3).map((cell) => cell.text())).toEqual(["30", "27", "25"]);
  expect(wrapper.get("details").text()).toContain(value.asset_identity);
  expect(wrapper.get("details").text()).toContain(value.provenance.fast_filter_asset_identity);
  expect(wrapper.get("details").text()).toContain(value.provenance.ranking_policy);
  expect(wrapper.get("details").text()).toContain("beam_size");
  expect(wrapper.get("details").attributes("open")).toBeUndefined();
});

test("a malformed modern record shows an error without legacy fallback, ranks or export", () => {
  const value = rankedForwardFixture();
  value.products[0].decoder_rank = 1;
  const wrapper = setup({ prediction: value, results: value.products });
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.find('[role="note"]').exists()).toBe(false);
  expect(wrapper.find('[aria-label="导出产物候选"]').exists()).toBe(false);
});

test("the actual CSV button exports all 30 ledger rows instead of the display slice", async () => {
  const value = rankedForwardFixture(), wrapper = setup({ prediction: value, results: value.products });
  await wrapper.get('[aria-label="导出产物候选"]').trigger("click");
  const csv = await new Promise((resolve) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.readAsText(saveAs.mock.calls[0][0]);
  });
  const records = Papa.parse(csv, { header: true }).data;
  expect(records).toHaveLength(30);
  expect(records[1]).toMatchObject({ decoder_rank: "2", native_rank: "2", joint_rank: "1" });
  expect(records[29].decoder_rank).toBe("30");
});

test("EOS run details localize unfinished status and retain all raw characters and the recorded token count in EN and CN", async () => {
  const value = incompleteForwardFixture(), before = JSON.stringify(value);
  const wrapper = setup({ prediction: value, results: value.products });
  const row = wrapper.get(".forward-ledger-table tbody tr:nth-child(4)");
  expect(row.text()).toContain(value.provenance.decoder.hypotheses[3].decoded_product);
  expect(row.text()).toContain("解码未完成");
  expect(row.text()).toContain("未终止");
  expect(row.text()).toContain("512");
  expect(wrapper.get(".forward-ledger-table thead").text()).toContain("EOS");
  expect(wrapper.get(".forward-ledger-table thead").text()).toContain("含 EOS");
  expect(wrapper.findAll(".forward-product-table tbody tr")).toHaveLength(10);
  setLocale("en", { persist: false }); await wrapper.vm.$nextTick();
  expect(row.text()).toContain("Incomplete decoding");
  expect(row.text()).toContain("Unfinished");
  expect(row.text()).toContain(value.provenance.decoder.hypotheses[3].decoded_product);
  expect(wrapper.get(".forward-ledger-table thead").text()).toContain("Decoded tokens (incl. EOS)");
  expect(JSON.stringify(value)).toBe(before);
});

test("EOS the actual export button retains termination fields for the full ledger including unfinished hypotheses", async () => {
  const value = incompleteForwardFixture(), wrapper = setup({ prediction: value, results: value.products });
  await wrapper.get('[aria-label="导出产物候选"]').trigger("click");
  const csv = await new Promise((resolve) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.readAsText(saveAs.mock.calls[0][0]);
  });
  const records = Papa.parse(csv, { header: true }).data;
  expect(records).toHaveLength(30);
  expect(records[3]).toMatchObject({ terminated_by_eos: "false", decoded_token_count: "512",
    decoded_product: value.provenance.decoder.hypotheses[3].decoded_product, product: "", native_rank: "", joint_rank: "" });
});

test("EOS an un-terminated native candidate is a visible error with no legacy repair or export", () => {
  const value = rankedForwardFixture();
  value.provenance.decoder.hypotheses[0].terminated_by_eos = false;
  const wrapper = setup({ prediction: value, results: value.products });
  expect(wrapper.get('[role="alert"]').text()).toContain("格式无效");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.find('[aria-label="导出产物候选"]').exists()).toBe(false);
});

test("EOS an unfinished first decoder cannot turn decoder two into the model's first choice in the visible table", () => {
  const value = leadingIncompleteForwardFixture(), wrapper = setup({ prediction: value, results: value.products });
  expect(wrapper.get(".forward-product-table tbody tr").findAll("td, th").slice(0, 2).map((cell) => cell.text())).toEqual(["2", "1"]);
  expect(wrapper.get(".forward-ledger-table tbody tr:first-child").text()).toContain("解码未完成");
  expect(wrapper.findAll(".forward-product-table tbody tr")).toHaveLength(1);
});
