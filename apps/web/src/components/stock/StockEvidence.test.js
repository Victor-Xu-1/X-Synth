import { mount } from "@vue/test-utils";
import StockEvidence from "./StockEvidence.vue";
import StockRecordList from "./StockRecordList.vue";
import { priceContractRecord } from "@/common/route-price-test-data";

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
