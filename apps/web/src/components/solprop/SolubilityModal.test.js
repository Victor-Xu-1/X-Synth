import { flushPromises, mount } from "@vue/test-utils";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";
import SolubilityModal from "./SolubilityModal.vue";

const Slot = { template: '<div><slot /></div>' };
test("English long model descriptions are complete phrases while raw upload examples, references and units stay unchanged", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const wrapper = mount(SolubilityModal, { props: { visible: true }, global: { stubs: {
    WorkbenchDialog: Slot, VCard: Slot, VCardTitle: Slot, VCardText: Slot, VCardActions: Slot, VSpacer: true,
    VBtn: { template: '<button><slot /></button>' },
  } } });
  try {
    expect(wrapper.text()).toContain("Solubility model input/output details");
    expect(wrapper.text()).toContain("CSV files must include headers and all columns");
    expect(wrapper.text()).toContain("method2 uses temperature-dependent dissolution enthalpy");
    expect(wrapper.text()).toContain("cal/K/mol"); expect(wrapper.text()).toContain("Vermeire, F. H.");
    const examples = wrapper.findAll("pre").map((block) => [block.element, block.text()]);
    const links = wrapper.findAll("a").map((link) => link.attributes("href"));
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.text()).toContain("溶解度模型输入 / 输出说明");
    wrapper.findAll("pre").forEach((block, index) => { expect(block.element).toBe(examples[index][0]); expect(block.text()).toBe(examples[index][1]); });
    expect(wrapper.findAll("a").map((link) => link.attributes("href"))).toEqual(links);
  } finally { wrapper.unmount(); }
});
