import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { priceContractRecord, priceContractResponse } from "@/common/route-price-test-data";
import MoleculeStockDialog from "./MoleculeStockDialog.vue";
import { initializeLocale, setLocale } from "@/i18n";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<span />" }));
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  VCard: { template: "<div><slot /></div>" },
  VBtn: { template: "<button><slot /></button>" }, VIcon: true,
};
const snapshot = "a".repeat(64);
const response = (record = priceContractRecord()) => priceContractResponse(record);
const wrappers = [];
function setup() {
  const wrapper = mount(MoleculeStockDialog, { props: { modelValue: true, smiles: "CCO", expectedSnapshot: snapshot }, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => API.post.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("purchase details render the same bound price and do not invent missing fields", async () => {
  API.post.mockResolvedValue(response());
  const wrapper = setup();
  await flushPromises();
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("币种未标注");
  expect(wrapper.text()).toContain("报价日期未记录");
  expect(wrapper.text()).toContain("目录与原任务快照一致");
  expect(wrapper.text()).not.toMatch(/USD|CNY|99%|人民币/);
});
test.each([null, 0, -1, Infinity, "5"])("missing/invalid legacy value %p cannot be a purchase price", async (ppg) => {
  const record = priceContractRecord({ amount: null, status: ppg === null ? "missing" : "invalid" });
  record.ppg = null;
  API.post.mockResolvedValue(response(record));
  const wrapper = setup();
  await flushPromises();
  expect(wrapper.text()).toContain(ppg === null ? "价格未记录" : "价格数据无效");
  expect(wrapper.find(".supplier-price-value").text()).not.toContain("$/g");
});
test("changing task snapshot invalidates a pending response even when the structure stays the same", async () => {
  let resolveOld;
  API.post.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const wrapper = setup();
  const empty = response();
  empty.results.CCO = [];
  API.post.mockResolvedValueOnce(empty);
  await wrapper.setProps({ expectedSnapshot: "b".repeat(64) });
  resolveOld(response());
  await flushPromises();
  expect(wrapper.text()).not.toContain("2.08 $/g");
  expect(wrapper.text()).toContain("不能替代原任务采购证据");
});
test("noncanonical purchase input uses the server receipt without structure-validation requests", async () => {
  const record = { ...priceContractRecord(), procurement: {
    policy: "defined_purchase_identity_v1", status: "defined", reason: null, eligible_for_closure: true,
  } };
  API.post.mockResolvedValueOnce({ ...response(record), requested: [{ smiles: "OCC", canonical_smiles: "CCO" }] });
  const wrapper = mount(MoleculeStockDialog, { props: { modelValue: true, smiles: "OCC", expectedSnapshot: snapshot }, global: { stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/api/v1/stock/lookup", { smiles: ["OCC"] });
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("defined");
});
test("failed lookup stays an error and does not become an empty catalog", async () => {
  API.post.mockRejectedValue(new Error("目录读取失败"));
  const wrapper = setup();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("无法读取采购记录");
  expect(wrapper.text()).not.toContain("没有精确结构匹配");
});

test.each([
  ["undefined_purchase_form", "Complete purchase form not recorded", "完整采购形式未记录"],
  ["indeterminate_purchase_structure", "Purchase structure indeterminate", "采购结构无法确定"],
])("%s is visible beside the actual supplier record without hiding CAS, price or links", async (reason, english, chinese) => {
  initializeLocale(null);
  const record = { ...priceContractRecord(), cas: "64-17-5", url: "https://example.org/catalogue", procurement: {
    policy: "defined_purchase_identity_v1", status: "unresolved", reason, eligible_for_closure: false,
  } };
  const value = response(record), before = JSON.stringify(value);
  API.post.mockResolvedValueOnce(value);
  const wrapper = setup(); await flushPromises();
  expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe("unresolved");
  expect(wrapper.text()).toContain(english);
  expect(wrapper.text()).toContain("Not a confirmed commercial starting material");
  setLocale("zh-CN", { persist: false }); await flushPromises();
  expect(wrapper.text()).toContain(chinese);
  expect(wrapper.text()).toContain("不能作为已确认商购原料");
  expect(wrapper.text()).toContain(record.catalog_id);
  expect(wrapper.text()).toContain(record.cas);
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.get(".stock-node-record a").attributes("href")).toBe(record.url);
  expect(JSON.stringify(value)).toBe(before);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test.each([[undefined, "unknown"], [null, "invalid"]])("missing or malformed decisions (%p) never display a closure eligibility claim", async (procurement, status) => {
  API.post.mockResolvedValueOnce(response({ ...priceContractRecord(), procurement }));
  const wrapper = setup(); await flushPromises();
  expect(wrapper.get("[data-procurement-status]").attributes("data-procurement-status")).toBe(status);
  expect(wrapper.text()).not.toContain("采购形式明确");
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(false);
  expect(wrapper.text()).toContain("2.08 $/g");
});

test("closing or changing a lookup retires the prior procurement status along with the record", async () => {
  const record = { ...priceContractRecord(), procurement: {
    policy: "defined_purchase_identity_v1", status: "unresolved", reason: "undefined_purchase_form", eligible_for_closure: false,
  } };
  API.post.mockResolvedValueOnce(response(record));
  const wrapper = setup(); await flushPromises();
  expect(wrapper.find(".procurement-material-limit").exists()).toBe(true);
  await wrapper.setProps({ modelValue: false });
  expect(wrapper.find("[data-procurement-status]").exists()).toBe(false);
  API.post.mockRejectedValueOnce(new Error("failed"));
  await wrapper.setProps({ modelValue: true, smiles: "N" }); await flushPromises();
  expect(wrapper.find("[data-procurement-status]").exists()).toBe(false);
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
});
