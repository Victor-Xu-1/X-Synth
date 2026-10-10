import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { priceContractRecord, priceContractResponse } from "@/common/route-price-test-data";
import MoleculeStockDialog from "./MoleculeStockDialog.vue";

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
  API.post.mockResolvedValueOnce({ ...response(), requested: [{ smiles: "OCC", canonical_smiles: "CCO" }] });
  const wrapper = mount(MoleculeStockDialog, { props: { modelValue: true, smiles: "OCC", expectedSnapshot: snapshot }, global: { stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/api/v1/stock/lookup", { smiles: ["OCC"] });
  expect(wrapper.text()).toContain("2.08 $/g");
});
test("failed lookup stays an error and does not become an empty catalog", async () => {
  API.post.mockRejectedValue(new Error("目录读取失败"));
  const wrapper = setup();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("无法读取采购记录");
  expect(wrapper.text()).not.toContain("没有精确结构匹配");
});
