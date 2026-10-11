import { mount } from "@vue/test-utils";
import StockEvidence from "./StockEvidence.vue";
import StockRecordList from "./StockRecordList.vue";
import { priceContractRecord } from "@/common/route-price-test-data";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import { initializeLocale, setLocale } from "@/i18n";

jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview", props: ["smiles", "label"], template: '<div class="evidence-structure">{{ smiles }}</div>',
}));

const snapshot = "a".repeat(64), expectedSnapshot = "b".repeat(64);
const result = (records = []) => ({ query: "OCC", smiles: "CCO", snapshot, expectedSnapshot, records });
const stubs = { VIcon: true };

test("selected supplier evidence retains original query, both snapshots and full shared price limitations", () => {
  const record = priceContractRecord();
  const wrapper = mount(StockEvidence, { props: { result: result([record]), record, snapshotMatches: false }, global: { stubs } });
  expect(wrapper.text()).toContain("OCC");
  expect(wrapper.text()).toContain("CCO");
  expect(wrapper.text()).toContain(snapshot);
  expect(wrapper.text()).toContain(expectedSnapshot);
  expect(wrapper.text()).toContain("快照不同");
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("非实时报价");
  expect(wrapper.text()).toContain("报价日期");
  expect(wrapper.text()).toContain("包装 / 纯度");
  expect(wrapper.text()).not.toMatch(/USD|CNY|人民币/);
  wrapper.unmount();
});

test("no record and unknown price do not become supplier availability or guessed catalog links", () => {
  const empty = mount(StockEvidence, { props: { result: result() }, global: { stubs } });
  expect(empty.text()).toContain("无精确目录记录");
  expect(empty.find('[aria-label="选中供应商目录证据"]').exists()).toBe(false);
  empty.unmount();
  const record = { smiles: "CCO", ppg: null, url: "javascript:alert(1)" };
  const wrapper = mount(StockEvidence, { props: { result: result([record]), record }, global: { stubs } });
  expect(wrapper.text()).toContain("价格未记录");
  expect(wrapper.text()).toContain("供应商未记录");
  expect(wrapper.find("a").exists()).toBe(false);
  expect(wrapper.text()).not.toMatch(/0\.00|现货|可商购/);
  wrapper.unmount();
});

test("vendor reading uses the same records and explicit origin selection without data transformation", async () => {
  const record = { smiles: "CCO", source: "supplier-a", catalog_id: "record-a", cas: "64-17-5", lead_time: "7-21days", ppg: null };
  const input = result([record]);
  const before = JSON.stringify(input);
  const wrapper = mount(StockRecordList, { props: { result: input }, global: { stubs } });
  expect(wrapper.text()).toContain("7-21days");
  expect(wrapper.text()).toContain("价格未记录");
  const button = wrapper.get("button");
  expect(button.attributes("type")).toBe("button");
  expect(button.attributes("aria-label")).toContain("supplier-a record-a");
  await button.trigger("click");
  expect(wrapper.emitted("select")[0][0]).toEqual({ index: 0, origin: button.element });
  expect(JSON.stringify(input)).toBe(before);
  wrapper.unmount();
});

test("supplier evidence keeps the confirmed structure primary and discloses full snapshot identity after supplier fields", () => {
  const record = Object.freeze({ smiles: "[13CH3][C@@H](O)C(=O)[O-].[Na+]", source: "原始供应商", catalog_id: "原始目录号", ppg: null });
  const input = Object.freeze({ ...result([record]), query: "[Na+].[13CH3][C@@H](O)C(=O)[O-]", smiles: record.smiles });
  const before = JSON.stringify(input);
  const wrapper = mount(StockEvidence, { props: { result: input, record, snapshotMatches: false }, global: { stubs } });
  const preview = wrapper.getComponent(StructurePreview);
  expect(preview.props()).toMatchObject({ smiles: input.smiles, label: "规范化结构" });
  const supplier = wrapper.get(".stock-supplier-evidence").element;
  const identity = wrapper.get("details.stock-query-identity");
  expect(supplier.compareDocumentPosition(identity.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(identity.element.open).toBe(false);
  expect(identity.get("summary").text()).toBe("检索身份与快照");
  expect(identity.text()).toContain(input.query);
  expect(identity.text()).toContain(input.snapshot);
  expect(identity.text()).toContain(input.expectedSnapshot);
  expect(wrapper.text()).toContain(record.source);
  expect(wrapper.text()).toContain(record.catalog_id);
  expect(JSON.stringify(input)).toBe(before);
  wrapper.unmount();
});

test("no-match evidence retains its confirmed query drawing without a supplier or price claim", () => {
  const wrapper = mount(StockEvidence, { props: { result: result() }, global: { stubs } });
  expect(wrapper.getComponent(StructurePreview).props()).toMatchObject({ smiles: "CCO", label: "规范化结构" });
  expect(wrapper.find(".stock-supplier-evidence").exists()).toBe(false);
  expect(wrapper.find(".supplier-price").exists()).toBe(false);
  wrapper.unmount();
});

test("selected record evidence shows the same bound procurement limit in both languages while retaining catalog and price data", async () => {
  initializeLocale(null);
  const record = { ...priceContractRecord(), cas: "64-17-5", url: "https://example.org/catalogue", procurement: {
    policy: "defined_purchase_identity_v1", status: "unresolved", reason: "undefined_purchase_form", eligible_for_closure: false,
  } };
  const input = result([record]), before = JSON.stringify(input);
  const wrapper = mount(StockEvidence, { props: { result: input, record, snapshotMatches: false }, global: { stubs } });
  try {
    expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("unresolved");
    expect(wrapper.text()).toContain("Complete purchase form not recorded");
    expect(wrapper.text()).toContain("Not a confirmed commercial starting material");
    expect(wrapper.text()).toContain("do not establish live supply, purity or experimental usability");
    setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("完整采购形式未记录");
    expect(wrapper.text()).toContain("不能作为已确认商购原料");
    expect(wrapper.text()).toContain(record.cas);
    expect(wrapper.text()).toContain(record.catalog_id);
    expect(wrapper.text()).toContain("2.08 $/g");
    expect(wrapper.get("a.catalog-link").attributes("href")).toBe(record.url);
    expect(JSON.stringify(input)).toBe(before);
  } finally { wrapper.unmount(); }
});

test("switching evidence context makes a supplied decision invalid rather than reusing the selected record's certainty", async () => {
  const record = { ...priceContractRecord(), procurement: {
    policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true,
  } };
  const input = result([record]);
  const wrapper = mount(StockEvidence, { props: { result: input, record }, global: { stubs } });
  try {
    expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("defined");
    await wrapper.setProps({ result: { ...input, snapshot: expectedSnapshot } });
    expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("invalid");
    expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
    await wrapper.setProps({ record: null });
    expect(wrapper.find("[data-procurement-status]").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});
