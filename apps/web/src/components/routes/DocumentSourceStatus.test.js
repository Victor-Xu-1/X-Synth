import { mount } from "@vue/test-utils";
import { initializeLocale, setLocale } from "@/i18n";
import DocumentSourceStatus from "./DocumentSourceStatus.vue";

test("source state offers only explicit retry and never promotes closure labels to purchase evidence", async () => {
  initializeLocale(null);
  const wrapper = mount(DocumentSourceStatus, { props: { loading: true }, global: { stubs: {
    VProgressCircular: true, VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  } } });
  expect(wrapper.text()).toContain("Reading original step evidence");
  await wrapper.setProps({ loading: false, error: "原始步骤证据读取超时，请重试。" });
  expect(wrapper.text()).toContain("timed out"); await wrapper.get("button").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  await wrapper.setProps({ error: "", loaded: { scope: "current_matching_source", source_closed: true, closure_sources: ["supplier"] } });
  expect(wrapper.text()).toContain("Current matching source"); expect(wrapper.text()).not.toContain("supplier");
  expect(wrapper.find("button").exists()).toBe(false);
  await wrapper.setProps({ loaded: null, unavailable: { reason: "source_structure_inconsistent" } });
  expect(wrapper.attributes("data-source-reason")).toBe("source_structure_inconsistent");
  await wrapper.setProps({ retired: true }); expect(wrapper.find("button").exists()).toBe(false);
  setLocale("zh-CN", { persist: false }); await wrapper.vm.$nextTick();
  expect(wrapper.text()).toContain("原始步骤证据已停用"); wrapper.unmount();
});
