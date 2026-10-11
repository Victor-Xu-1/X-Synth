import { mount } from "@vue/test-utils";
import { initializeLocale, setLocale } from "@/i18n";
import { priceContractRecord } from "@/common/route-price-test-data";
import ProcurementStatus from "./ProcurementStatus.vue";

const decision = { policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true };
const context = { snapshot: "a".repeat(64), smiles: "CCO" };
const wrappers = [];
const record = (procurement = decision) => ({ ...priceContractRecord(), procurement });
function setup(row, props = {}) {
  const wrapper = mount(ProcurementStatus, { props: { record: row, ...context, ...props }, global: { stubs: { VIcon: true } } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test.each([
  [decision, "defined", "采购形式明确", "Purchase form defined"],
  [undefined, "unknown", "采购形式未核验", "Purchase form unreviewed"],
  [null, "invalid", "采购依据无效", "Procurement evidence invalid"],
])("%s uses the shared record status in English and Chinese without a closure or availability claim", async (procurement, status, chinese, english) => {
  initializeLocale(null);
  const row = procurement === undefined ? priceContractRecord() : record(procurement), before = JSON.stringify(row);
  const wrapper = setup(row);
  expect(wrapper.attributes("data-procurement-status")).toBe(status);
  expect(wrapper.get(".procurement-status-label").text()).toBe(english);
  expect(wrapper.text()).toContain("Catalogue records do not establish live supply, purity or experimental usability.");
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
  expect(wrapper.classes()).not.toContain("procurement-warning");
  expect(wrapper.text()).not.toMatch(/in stock|available to buy|closure eligible/i);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.get(".procurement-status-label").text()).toBe(chinese);
  expect(wrapper.text()).toContain("目录记录不代表实时供货、纯度或实验可用性。");
  expect(JSON.stringify(row)).toBe(before);
});

test.each([
  ["undefined_purchase_form", "完整采购形式未记录", "Complete purchase form not recorded"],
  ["indeterminate_purchase_structure", "采购结构无法确定", "Purchase structure indeterminate"],
])("%s keeps the reason and closure restriction visible even in compact rows", async (reason, chinese, english) => {
  initializeLocale(null);
  const wrapper = setup(record({ ...decision, status: "unresolved", reason, eligible_for_closure: false }), { compact: true });
  expect(wrapper.attributes("data-procurement-status")).toBe("unresolved");
  expect(wrapper.classes()).toContain("procurement-warning");
  expect(wrapper.text()).toContain("Purchase form unresolved");
  expect(wrapper.get(".procurement-status-reason").text()).toContain(english);
  expect(wrapper.get(".procurement-material-limit").text()).toBe("Not a confirmed commercial starting material");
  expect(wrapper.text()).not.toMatch(/\b(?:leaf|node|closure)\b/i);
  expect(wrapper.get(".procurement-status-label").attributes("title")).toContain("do not establish live supply");
  expect(wrapper.find(".procurement-boundary").exists()).toBe(false);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain(chinese);
  expect(wrapper.get(".procurement-material-limit").text()).toBe("不能作为已确认商购原料");
  expect(wrapper.text()).not.toMatch(/闭合叶子|闭合节点/);
});

test.each([
  { snapshot: "b".repeat(64) }, { smiles: "OCC" },
])("unbound context %s stays invalid rather than confirming a purchase form", props => {
  const wrapper = setup(record(), props);
  expect(wrapper.attributes("data-procurement-status")).toBe("invalid");
  expect(wrapper.text()).toContain("采购依据无效");
  expect(wrapper.text()).not.toContain("采购形式明确");
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
});

test.each([{}, { snapshot: context.snapshot }, { smiles: context.smiles },
  { snapshot: "", smiles: context.smiles }, { snapshot: context.snapshot, smiles: "" },
])("missing or empty current query context %s remains unreviewed even for a defined record", props => {
  const wrapper = mount(ProcurementStatus, { props: { record: record(), ...props }, global: { stubs: { VIcon: true } } });
  wrappers.push(wrapper);
  expect(wrapper.attributes("data-procurement-status")).toBe("unknown");
  expect(wrapper.text()).toContain("采购形式未核验");
  expect(wrapper.text()).not.toContain("采购形式明确");
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
});

test.each([
  { ...decision, eligible_for_closure: false },
  { ...decision, status: "unresolved", reason: "undefined_purchase_form" },
  { ...decision, policy: "future" },
])("contradictory or unsupported wire decisions are invalid (%#)", value => {
  expect(setup(record(value)).attributes("data-procurement-status")).toBe("invalid");
});

test("switching records removes the prior restriction and never infers chemistry from a structure or CAS", async () => {
  const row = record({ ...decision, status: "unresolved", reason: "undefined_purchase_form", eligible_for_closure: false });
  const wrapper = setup(row);
  expect(wrapper.text()).toContain("不能作为已确认商购原料");
  const ionic = { ...record(), smiles: "O=C([O-])[O-]", cas: "3812-32-6" };
  ionic.price.record_key = { ...ionic.price.record_key, smiles: ionic.smiles };
  await wrapper.setProps({ record: ionic, smiles: ionic.smiles });
  expect(wrapper.attributes("data-procurement-status")).toBe("defined");
  expect(wrapper.find(".procurement-status-reason").exists()).toBe(false);
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
  await wrapper.setProps({ record: priceContractRecord(), ...context });
  expect(wrapper.attributes("data-procurement-status")).toBe("unknown");
});
