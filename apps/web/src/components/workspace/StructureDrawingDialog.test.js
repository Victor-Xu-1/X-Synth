import { flushPromises, mount } from "@vue/test-utils";
import { h, ref } from "vue";
import { useResizeObserver } from "@vueuse/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import StructureDrawingDialog from "./StructureDrawingDialog.vue";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import { provideWorkbenchActivity } from "./workbench-activity";

global.CSS = { supports: () => false };
const { createVuetify, components } = require("vuetify/dist/vuetify.js");

jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "inputType", "width", "height", "showErrorImage", "eager"],
  emits: ["load"], template: '<div><img :alt="smiles" /></div>',
}));
const stubs = {
  VDefaultsProvider: { template: '<slot />' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(StructureDrawingDialog, { props: { smiles: "CCO", ...props }, attachTo: document.body,
    slots: { activator: ({ showPreview }) => h("div", ["first", "second"].map(name => h("button", {
      class: `open-${name}`, onClick: showPreview,
    }, name))) }, global: { stubs } });
  wrappers.push(wrapper);
  wrapper.findAll(".open-first, .open-second").forEach(button => {
    jest.spyOn(button.element, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  });
  return wrapper;
}
async function open(wrapper, name = "first") {
  const origin = wrapper.get(`.open-${name}`).element;
  origin.focus(); origin.click(); await flushPromises();
  const viewport = wrapper.find(".structure-viewer-viewport");
  if (viewport.exists()) viewport.element.focus();
  return origin;
}
async function close(wrapper) {
  const dialog = wrapper.getComponent(WorkbenchDialog);
  const button = wrapper.get('[aria-label="关闭结构预览"]').element;
  button.focus(); button.click(); await flushPromises();
  return dialog;
}
beforeEach(() => { jest.clearAllMocks(); });
beforeAll(() => {
  window.matchMedia = jest.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.visualViewport = undefined;
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); jest.restoreAllMocks(); });

test("one read-only renderer preserves exact reaction input and bounded zoom/fit", async () => {
  const smiles = "[13CH3]O>>[13CH2]=O", wrapper = setup({ smiles, inputType: "reaction" });
  await open(wrapper);
  const drawing = wrapper.getComponent({ name: "SmilesImage" });
  expect(drawing.props()).toMatchObject({ smiles, inputType: "reaction", eager: true, showErrorImage: false });
  for (let i = 0; i < 20; i++) await wrapper.get('[aria-label="放大结构"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("600%");
  expect(wrapper.get('[aria-label="放大结构"]').element.disabled).toBe(true);
  for (let i = 0; i < 20; i++) await wrapper.get('[aria-label="缩小结构"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("50%");
  await wrapper.get('[aria-label="结构适应窗口"]').trigger("click");
  expect(wrapper.get("output").text()).toBe("100%");
  expect(wrapper.emitted("update:smiles")).toBeUndefined();
  expect(wrapper.props("smiles")).toBe(smiles);
});

test("actual image aspect ratio fits a resized viewport without discarding its zoom", async () => {
  const wrapper = setup(); await open(wrapper);
  const drawing = wrapper.getComponent({ name: "SmilesImage" });
  Object.defineProperties(drawing.get("img").element, {
    complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 300 },
  });
  drawing.vm.$emit("load"); await flushPromises();
  const resize = useResizeObserver.mock.calls[0][1];
  resize([{ contentRect: { width: 300, height: 200 } }]); await flushPromises();
  expect(drawing.props()).toMatchObject({ width: 300, height: 75 });
  await wrapper.get('[aria-label="放大结构"]').trigger("click");
  resize([{ contentRect: { width: 200, height: 100 } }]); await flushPromises();
  expect(wrapper.get("output").text()).toBe("125%");
  expect(drawing.props()).toMatchObject({ width: 250, height: 62 });
});

test("late leave from an older presentation cannot consume the newer closed presentation's focus", async () => {
  const wrapper = setup(); await open(wrapper);
  const first = await close(wrapper);
  const origin = await open(wrapper, "second"), second = await close(wrapper);
  first.vm.$emit("afterLeave"); await flushPromises();
  expect(document.activeElement === origin).toBe(false);
  second.vm.$emit("afterLeave"); await flushPromises();
  expect(document.activeElement === origin).toBe(true);
});

test.each(["smiles", "inputType", "contextKey"])("a %s replacement retires the old dialog without return focus", async property => {
  const wrapper = setup(), origin = await open(wrapper), dialog = wrapper.getComponent(WorkbenchDialog);
  await wrapper.setProps({ [property]: property === "smiles" ? "CCN" : property === "inputType" ? "reaction" : "next-route" });
  dialog.vm.$emit("afterLeave"); await flushPromises();
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  expect(document.activeElement === origin).toBe(false);
});

test("a new pointer intent during closing is not overridden by focus restoration", async () => {
  const wrapper = setup(), origin = await open(wrapper), dialog = await close(wrapper);
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  dialog.vm.$emit("afterLeave"); await flushPromises();
  expect(document.activeElement === origin).toBe(false);
});

test("blank input cannot open a drawing even through an enabled custom activator", async () => {
  const wrapper = setup({ smiles: "  " }); await open(wrapper);
  expect(wrapper.findComponent(WorkbenchDialog).exists()).toBe(false);
});

test("workbench suspension blocks stale focus and new opening without losing the existing drawing state", async () => {
  const active = ref(true);
  const parent = mount({ components: { StructureDrawingDialog }, setup() { provideWorkbenchActivity(active); },
    template: '<StructureDrawingDialog smiles="CCO"><template #activator="{ showPreview }"><button class="open-drawing" @click="showPreview" /></template></StructureDrawingDialog>',
  }, { attachTo: document.body, global: {
    stubs: { ...stubs, VDialog: false, VDefaultsProvider: false, transition: false },
    plugins: [createVuetify({ components: { VDialog: components.VDialog, VDefaultsProvider: components.VDefaultsProvider },
      defaults: { VDialog: { transition: false } }, theme: false })],
  } });
  wrappers.push(parent);
  const origin = parent.get(".open-drawing").element;
  origin.focus(); origin.click(); await flushPromises();
  parent.get('[aria-label="放大结构"]').element.focus();
  await parent.get('[aria-label="放大结构"]').trigger("click");
  expect(parent.get("output").text()).toBe("125%");
  active.value = false; await flushPromises();
  expect(parent.get('[role="dialog"]').attributes('aria-hidden')).toBe('true');
  expect(parent.get('[role="dialog"]').attributes('inert')).toBeDefined();
  expect(parent.get('.structure-viewer').isVisible()).toBe(false);
  origin.click(); await flushPromises();
  expect(parent.get('.structure-viewer').isVisible()).toBe(false);
  active.value = true; await flushPromises();
  expect(parent.get('[role="dialog"]').attributes('aria-hidden')).toBeUndefined();
  expect(parent.get('[role="dialog"]').attributes('inert')).toBeUndefined();
  expect(parent.get("output").text()).toBe("125%");
  const dialog = parent.getComponent(WorkbenchDialog);
  parent.get('[aria-label="关闭结构预览"]').element.click(); await flushPromises();
  dialog.vm.$emit("afterLeave"); await flushPromises();
  expect(document.activeElement === origin).toBe(false);
});

test("unmount releases pending close focus and image measurements", async () => {
  const wrapper = setup(), origin = await open(wrapper), pending = wrapper.vm.measureImage();
  const dialog = await close(wrapper);
  wrapper.unmount();
  dialog.vm.$emit("afterLeave"); await pending; await flushPromises();
  expect(document.activeElement === origin).toBe(false);
});

test.each(["../routes/RouteStepStructure.vue", "StructureDrawingDialog.vue", "StructurePreview.vue"])(
  "%s compiles its real Vue script, template and scoped styles", relative => {
    const filename = resolve(__dirname, relative), { descriptor, errors } = parse(readFileSync(filename, "utf8"), { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "drawing-contract" });
    expect(compileTemplate({ filename, id: "drawing-contract", source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([]);
    descriptor.styles.forEach(style => expect(compileStyle({ filename, id: "drawing-contract", source: style.content, scoped: true }).errors).toEqual([]));
  },
);

test("the single shared viewer keeps short-screen scrolling and 44px controls", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "StructureDrawingDialog.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const values = selector => Object.fromEntries(css.nodes.find(rule => rule.selector === selector).nodes
    .filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  expect(values(".structure-viewer")).toMatchObject({ display: "flex", "max-height": "calc(100dvh - 48px)" });
  expect(values(".structure-viewer header")["flex-shrink"]).toBe("0");
  expect(values(".structure-viewer-viewport")).toMatchObject({ flex: "1 1 auto", "min-height": "0", overflow: "auto" });
  expect(values(".structure-viewer header :deep(.v-btn)")).toMatchObject({ width: "44px", height: "44px" });
});
