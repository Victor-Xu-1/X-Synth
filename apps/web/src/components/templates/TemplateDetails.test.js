import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import TemplateDetails from "./TemplateDetails.vue";
import { initializeLocale, setLocale } from "@/i18n";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });

test("template labels are bilingual while all original template and reference values are preserved", async () => {
  initializeLocale(null);
  const template = { template_id: "名称", count: 1, source: "Pistachio", template_set: "pistachio",
    raw: { _id: "原始记录", index: 0 }, direction: "retro", domain: "工艺核算",
    reaction_smarts: "[C:1]>>[C:1]", necessary_reagent: "水", intra_only: false, dimer_only: false,
    attributes: { 名称: "状态" }, references: [{ title: "工艺核算", url: "https://example.org/reference" }] };
  const original = JSON.stringify(template);
  const wrapper = mount(TemplateDetails, { props: { template }, global: { stubs: { VIcon: true } } });
  try {
    expect(wrapper.text()).toContain("Reagents and constraints");
    expect(wrapper.text()).toContain("1 example");
    expect(wrapper.text()).toContain("Retrosynthesis");
    expect(wrapper.get("h2").text()).toBe("Retrosynthesis template");
    expect(wrapper.get('[data-section="technical"]').text()).toContain("名称");
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

test("source metadata is an inspectable layer rather than the default heading", async () => {
  const template = { template_id: "pistachio:long-native-identifier", count: 1, source: "pistachio", template_set: "pistachio",
    raw: { _id: "long-native-identifier", index: 0 }, direction: "retro", domain: "strict_synthesis",
    reaction_smarts: "[C:1]>>[C:1]", necessary_reagent: "", intra_only: false, dimer_only: false,
    attributes: {}, references: [100, 101] };
  const wrapper = mount(TemplateDetails, { props: { template }, global: { stubs: { VIcon: true } } });
  try {
    expect(wrapper.get('[data-section="overview"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-section="technical"]').isVisible()).toBe(false);
    const references = wrapper.findAll('[role="tab"]').find(tab => /参考记录|Reference records/.test(tab.text()));
    await references.trigger("click");
    expect(wrapper.get('[data-section="references"]').isVisible()).toBe(true);
    expect(wrapper.findAll(".template-references li")).toHaveLength(2);
    await wrapper.setProps({ template: { ...template, template_id: "ord:next", source: "ord" } });
    expect(wrapper.get('[data-section="overview"]').isVisible()).toBe(true);
    expect(wrapper.get('[data-section="references"]').isVisible()).toBe(false);
  } finally { wrapper.unmount(); }
});
