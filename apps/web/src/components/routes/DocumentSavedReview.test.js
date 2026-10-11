import { mount } from "@vue/test-utils";
import { initializeLocale, setLocale } from "@/i18n";
import { sourceReceipt } from "@/common/document-source-evidence.test-support";
import DocumentSavedReview from "./DocumentSavedReview.vue";

test("copy-time receipt is collapsed, explicitly historical and never a current-inspection badge", async () => {
  initializeLocale(null);
  const receipt = sourceReceipt("model_checked"), before = JSON.stringify(receipt);
  const wrapper = mount(DocumentSavedReview, { props: { receipt }, global: { stubs: { VIcon: true } } });
  expect(wrapper.element.tagName).toBe("DETAILS");
  expect(wrapper.element.open).toBe(false);
  expect(wrapper.get("summary").text()).toBe("Copy-time review record");
  expect(wrapper.text()).toContain("Historical receipt, not a current source inspection.");
  expect(wrapper.find(".document-current-review").exists()).toBe(false);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("历史票据，不代表当前来源核验。");
  expect(JSON.stringify(receipt)).toBe(before);
  await wrapper.setProps({ receipt: null }); expect(wrapper.find("details").exists()).toBe(false);
  wrapper.unmount();
});
