import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import TemplateDetails from "./TemplateDetails.vue";
import { initializeLocale, setLocale } from "@/i18n";

test("template labels are bilingual while all original template and reference values are preserved", async () => {
  initializeLocale(null);
  const template = { template_id: "名称", count: 1, source: "Pistachio", template_set: "pistachio",
    raw: { _id: "原始记录", index: 0 }, direction: "retro", domain: "工艺核算",
    reaction_smarts: "[C:1]>>[C:1]", necessary_reagent: "水", intra_only: false, dimer_only: false,
    attributes: { 名称: "状态" }, references: [{ title: "工艺核算", url: "https://example.org/reference" }] };
  const original = JSON.stringify(template);
  const wrapper = mount(TemplateDetails, { props: { template } });
  try {
    expect(wrapper.text()).toContain("Reagents and constraints");
    expect(wrapper.text()).toContain("1 example");
    expect(wrapper.text()).toContain("Retrosynthesis");
    expect(wrapper.get("h2").text()).toBe("名称");
    expect(wrapper.get("pre").text()).toBe(template.reaction_smarts);
    expect(wrapper.text()).toContain("工艺核算");
    expect(wrapper.text()).toContain("水");
    expect(wrapper.get("a").text()).toBe("Original source");
    const reference = wrapper.get("a").element;
    setLocale("zh-CN", { persist: false }); await nextTick();
    expect(wrapper.text()).toContain("试剂与限制");
    expect(wrapper.get("a").element).toBe(reference);
    expect(wrapper.get("a").text()).toBe("原始来源");
    expect(JSON.stringify(template)).toBe(original);
  } finally { wrapper.unmount(); }
});
