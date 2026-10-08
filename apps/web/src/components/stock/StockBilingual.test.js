import { flushPromises, mount } from "@vue/test-utils";
import { initializeLocale, setLocale } from "@/i18n";
import StockEvidence from "./StockEvidence.vue";
import StockRecordList from "./StockRecordList.vue";

const wrappers = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
const record = Object.freeze({ smiles: "[Na+].[Cl-]", source: "目录价格基准", catalog_id: "证据详情", cas: "7647-14-5", lead_time: "原始交期 7-21days", ppg: null, url: "https://example.org/catalogue" });
const input = Object.freeze({ query: "[Cl-].[Na+]", smiles: record.smiles, snapshot: "a".repeat(64), expectedSnapshot: "b".repeat(64), records: Object.freeze([record]) });
function render(component, props) {
  initializeLocale(null);
  const wrapper = mount(component, { props, global: { stubs: { VIcon: true } } });
  wrappers.push(wrapper); return wrapper;
}

test("English catalogue evidence retains supplier identity and immutable raw fields on Chinese switch", async () => {
  const before = JSON.stringify(input);
  const wrapper = render(StockEvidence, { result: input, record, snapshotMatches: false });
  expect(wrapper.get(".stock-supplier-evidence h3").text()).toBe("目录价格基准");
  expect(wrapper.text()).toContain("Query identity and snapshot");
  expect(wrapper.text()).toContain("not a live supply guarantee");
  expect(wrapper.text()).toContain(input.query);
  expect(wrapper.text()).toContain(input.smiles);
  expect(wrapper.text()).toContain(input.snapshot);
  expect(wrapper.text()).toContain(input.expectedSnapshot);
  expect(wrapper.get(".supplier-price-value").text()).toBe("Price not recorded");
  const link = wrapper.get("a.catalog-link");
  expect(link.attributes()).toMatchObject({ href: record.url, target: "_blank", rel: "noopener noreferrer" });
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get(".stock-supplier-evidence h3").text()).toBe("目录价格基准");
  expect(wrapper.get(".supplier-price-value").text()).toBe("价格未记录");
  expect(wrapper.text()).toContain(record.catalog_id);
  expect(wrapper.text()).toContain(record.cas);
  expect(wrapper.text()).toContain(record.lead_time);
  expect(wrapper.get("a.catalog-link").element).toBe(link.element);
  expect(JSON.stringify(input)).toBe(before);
});

test("translated actions retain their exact selection index and original focused DOM control", async () => {
  const wrapper = render(StockRecordList, { result: input }), button = wrapper.get("button");
  expect(button.text()).toBe("Evidence details");
  expect(button.attributes("aria-label")).toBe("View evidence details for 目录价格基准 证据详情");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get("button").element).toBe(button.element);
  expect(button.text()).toBe("证据详情");
  await button.trigger("click");
  expect(wrapper.emitted("select")).toEqual([[{ index: 0, origin: button.element }]]);
});

test("missing record identity and no exact match are controlled fallbacks, not availability claims", () => {
  const empty = render(StockEvidence, { result: { ...input, records: [] } });
  expect(empty.text()).toContain("No exact catalogue record");
  expect(empty.find("a").exists()).toBe(false);
  const list = render(StockRecordList, { result: { ...input, records: [{ smiles: input.smiles }] } });
  expect(list.get("button").attributes("aria-label")).toBe("View evidence details for Supplier not recorded Catalogue records");
  expect(list.find("a").exists()).toBe(false);
});
