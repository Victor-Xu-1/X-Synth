import { mount } from "@vue/test-utils";
import { priceContractRecord } from "@/common/route-price-test-data";
import SupplierPrice from "./SupplierPrice.vue";

test("price evidence distinguishes directory baseline, unknown ISO currency and quote date", () => {
  const record = priceContractRecord();
  const wrapper = mount(SupplierPrice, { props: { record, snapshot: record.price.snapshot, smiles: record.smiles } });
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("非实时报价");
  expect(wrapper.text()).toContain("币种未标注");
  expect(wrapper.text()).toContain("报价日期未记录");
  expect(wrapper.text()).toContain(record.price.catalog_sha256);
  expect(wrapper.get("a").attributes("href")).toBe(record.price.unit_evidence);
  expect(wrapper.text()).not.toMatch(/USD|CNY|人民币|成本/);
  wrapper.unmount();
});
test("compact nodes keep the same formatter and baseline label", () => {
  const wrapper = mount(SupplierPrice, { props: { record: priceContractRecord(), compact: true } });
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("目录基准 · 币种未标注");
  expect(wrapper.get(".supplier-price-value").attributes("title")).toContain("非实时报价");
  expect(wrapper.find("details").exists()).toBe(false);
  wrapper.unmount();
});
test("unverified prices have no evidence link or numeric price", async () => {
  const wrapper = mount(SupplierPrice, { props: { record: { ppg: 7.09 } } });
  expect(wrapper.text()).toContain("价格依据未核验");
  expect(wrapper.text()).not.toContain("7.09");
  expect(wrapper.find("a").exists()).toBe(false);
  await wrapper.setProps({ record: priceContractRecord(), smiles: "O" });
  expect(wrapper.text()).toContain("价格数据无效");
  expect(wrapper.find("a").exists()).toBe(false);
  wrapper.unmount();
});
