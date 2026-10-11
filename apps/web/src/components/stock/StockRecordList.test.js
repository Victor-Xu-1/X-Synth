import { mount } from "@vue/test-utils";
import { priceContractRecord } from "@/common/route-price-test-data";
import StockRecordList from "./StockRecordList.vue";

const decision = { policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true };
const record = procurement => ({ ...priceContractRecord(), cas: "64-17-5", lead_time: "原始货期", url: "https://example.org/catalogue", procurement });
const result = records => ({ query: "OCC", smiles: "CCO", snapshot: "a".repeat(64), records });
const wrappers = [];
function setup(value) {
  const wrapper = mount(StockRecordList, { props: { result: value }, global: { stubs: { VIcon: true } } });
  wrappers.push(wrapper); return wrapper;
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("supplier rows keep their own status and all catalog fields rather than promoting every exact hit", async () => {
  const value = result([record(decision), record({ ...decision, status: "unresolved", reason: "undefined_purchase_form", eligible_for_closure: false }), record(undefined), record(null)]);
  const before = JSON.stringify(value), wrapper = setup(value);
  expect(wrapper.findAll("[data-procurement-status]").map(status => status.attributes("data-procurement-status")))
    .toEqual(["defined", "unresolved", "unknown", "invalid"]);
  expect(wrapper.findAll(".procurement-material-limit")).toHaveLength(1);
  const rows = wrapper.findAll(".stock-record");
  for (const row of rows) {
    expect(row.text()).toContain("contract-record");
    expect(row.text()).toContain("64-17-5");
    expect(row.text()).toContain("原始货期");
    expect(row.text()).toContain("2.08 $/g");
    expect(row.get("a").attributes()).toMatchObject({ href: value.records[0].url, rel: "noopener noreferrer" });
  }
  const button = rows[1].get("button");
  await button.trigger("click");
  expect(wrapper.emitted("select")).toEqual([[{ index: 1, origin: button.element }]]);
  expect(JSON.stringify(value)).toBe(before);
});

test.each([{ snapshot: "b".repeat(64) }, { smiles: "OCC" }])("a stale result context %s cannot transfer procurement certainty", overrides => {
  const wrapper = setup({ ...result([record(decision)]), ...overrides });
  expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("invalid");
  expect(wrapper.text()).not.toContain("采购形式明确");
});
