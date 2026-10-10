import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import StructurePreview from "./StructurePreview.vue";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles", "inputType", "width", "height"],
  emits: ["load"],
  template: '<div class="test-image"><img :alt="smiles" /></div>',
}));
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
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

test("normal close returns focus only after the dialog leaves, not on its model update", async () => {
  const wrapper = mount(StructurePreview, { attachTo: document.body, props: { smiles: "CCO" }, global: { stubs } });
  try {
    const origin = wrapper.get('[aria-label="放大结构预览"]').element;
    jest.spyOn(origin, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
    origin.focus();
    origin.click();
    await nextTick();
    const dialog = wrapper.getComponent(WorkbenchDialog);
    const close = wrapper.get('[aria-label="关闭结构预览"]').element;
    close.focus();
    close.click();
    await nextTick();
    await nextTick();
    expect(document.activeElement === origin).toBe(false);
    dialog.vm.$emit("afterLeave");
    await nextTick();
    expect(document.activeElement === origin).toBe(true);
  } finally { wrapper.unmount(); jest.restoreAllMocks(); }
});

test("existing preview defaults and reaction input are passed verbatim to the thumbnail", () => {
  const wrapper = mount(StructurePreview, { props: { smiles: "[13CH3]O>>[13CH2]=O", inputType: "reaction" }, global: { stubs } });
  try {
    expect(wrapper.props()).toMatchObject({ width: 260, height: 160, label: "结构预览" });
    const image = wrapper.getComponent({ name: "SmilesImage" });
    expect(image.props()).toMatchObject({ inputType: "reaction", width: 260, height: 160, smiles: "[13CH3]O>>[13CH2]=O" });
    expect(wrapper.find("img").attributes("alt")).toBe("[13CH3]O>>[13CH2]=O");
  } finally { wrapper.unmount(); }
});
test("short screens shrink the scrolling canvas without hiding it beneath the fixed header", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "StructureDrawingDialog.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const values = selector => Object.fromEntries(css.nodes.find(rule => rule.selector === selector).nodes.filter(node => node.type === "decl").map(node => [node.prop,node.value]));
  expect(values(".structure-viewer").display).toBe("flex");
  expect(values(".structure-viewer")["max-height"]).toBe("calc(100dvh - 48px)");
  expect(values(".structure-viewer header")["flex-shrink"]).toBe("0");
  expect(values(".structure-viewer-viewport").flex).toBe("1 1 auto");
  expect(values(".structure-viewer-viewport")["min-height"]).toBe("0");
});
