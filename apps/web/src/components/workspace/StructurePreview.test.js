import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import StructurePreview from "./StructurePreview.vue";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles", "inputType", "width", "height"],
  emits: ["load"],
  template: '<div class="test-image"><img :alt="smiles" /></div>',
}));
const stubs = {
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
};
test("preview remains read-only and zoom controls are bounded and resettable", async () => {
  const wrapper = mount(StructurePreview, {props:{smiles:"CCO",label:"化合物结构"},global:{stubs}});
  await wrapper.get('[aria-label="放大化合物结构"]').trigger("click");
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
  expect(wrapper.get("output").text()).toBe("100%");
  for (let i=0;i<20;i++) await wrapper.get('[aria-label="放大结构"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("600%");
  expect(wrapper.get('[aria-label="放大结构"]').element.disabled).toBe(true);
  await wrapper.get('[aria-label="结构适应窗口"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("100%");
  for (let i=0;i<20;i++) await wrapper.get('[aria-label="缩小结构"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("50%");
  expect(wrapper.get('[aria-label="缩小结构"]').element.disabled).toBe(true);
  expect(wrapper.emitted("update:smiles")).toBeUndefined();
  expect(wrapper.props("smiles")).toBe("CCO");
  await wrapper.setProps({smiles:"CCN"});
  await nextTick();
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  expect(wrapper.findAll("img").every(image => image.attributes("alt") === "CCN")).toBe(true);
  wrapper.unmount();
});
test("an empty structure cannot open a misleading viewer", () => {
  const wrapper = mount(StructurePreview, {props:{smiles:""},global:{stubs}});
  expect(wrapper.get('[aria-label="放大结构预览"]').element.disabled).toBe(true);
  wrapper.unmount();
});
