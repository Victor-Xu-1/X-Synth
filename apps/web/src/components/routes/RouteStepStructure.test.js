import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import RouteStepStructure from "./RouteStepStructure.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";

jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "width", "height", "showErrorImage"],
  template: '<div><button class="drawing-retry" /></div>',
}));
const stubs = {
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VIcon: true,
};
const wrappers = [];
function setup(props = {}) {
  const wrapper = mount(RouteStepStructure, { attachTo: document.body,
    props: { nodeId: "source-molecule", smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]", label: "产物", selectLabel: "查看步骤 1产物", ...props },
    global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); jest.restoreAllMocks(); });

test.each([0, 1])("detail=%i selection forwards the exact node/event/currentTarget synchronously", detail => {
  let received;
  const wrapper = setup({ product: true, onSelect: (id, event) => { received = { id, event, origin: event.currentTarget }; } });
  const button = wrapper.get("button.step-product").element;
  const event = new MouseEvent("click", { bubbles: true, detail });
  button.dispatchEvent(event);
  expect(received.id).toBe("source-molecule");
  expect(received.event === event).toBe(true);
  expect(received.origin === button).toBe(true);
  expect(wrapper.find("button button").exists()).toBe(false);
});

test("magnification opens the same SMILES and returns to its own button only on normal leave", async () => {
  const wrapper = setup();
  const origin = wrapper.get(".step-structure-enlarge").element;
  jest.spyOn(origin, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  origin.focus(); origin.click(); await flushPromises();
  const viewer = wrapper.getComponent({ name: "StructureDrawingDialog" });
  const images = wrapper.findAllComponents({ name: "SmilesImage" });
  expect(images).toHaveLength(2);
  expect(images.map(image => image.props("smiles"))).toEqual([wrapper.props("smiles"), wrapper.props("smiles")]);
  expect(wrapper.emitted("select")).toBeUndefined();
  const dialog = viewer.getComponent(WorkbenchDialog);
  const close = wrapper.get('[aria-label="关闭结构预览"]').element;
  close.focus(); close.click(); await flushPromises();
  expect(document.activeElement === origin).toBe(false);
  dialog.vm.$emit("afterLeave"); await flushPromises();
  expect(document.activeElement === origin).toBe(true);
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
});

test("missing node identity disables details but a recorded structure can still be inspected", async () => {
  const wrapper = setup({ nodeId: null });
  expect(wrapper.get(".step-molecule").element.disabled).toBe(true);
  expect(wrapper.get(".step-structure-enlarge").element.disabled).toBe(false);
  await wrapper.get(".step-structure-enlarge").trigger("click");
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
  expect(wrapper.emitted("select")).toBeUndefined();
  await wrapper.setProps({ smiles: "  " });
  expect(wrapper.get(".step-structure-enlarge").element.disabled).toBe(true);
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
});

test("changing only node identity retires a same-structure viewer without stale return focus", async () => {
  const wrapper = setup(), origin = wrapper.get(".step-structure-enlarge").element;
  origin.focus(); origin.click(); await flushPromises();
  const dialog = wrapper.getComponent(WorkbenchDialog);
  wrapper.get('[aria-label="关闭结构预览"]').element.focus();
  await wrapper.setProps({ nodeId: "replacement-molecule" });
  dialog.vm.$emit("afterLeave"); await flushPromises();
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  expect(document.activeElement === origin).toBe(false);
  expect(wrapper.props("smiles")).toBe("[13CH3][C@H]([NH3+])CO.[Cl-]");
});

test("each step figure uses stable responsive drawing dimensions and 44px native actions", () => {
  const wrapper = setup(), image = wrapper.getComponent({ name: "SmilesImage" });
  expect(image.props()).toMatchObject({ width: 320, height: 200, showErrorImage: false });
  const { descriptor } = parse(readFileSync(resolve(__dirname, "RouteStepStructure.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const values = selector => Object.fromEntries(css.nodes.find(rule => rule.selector === selector).nodes
    .filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  expect(values(".step-molecule")["min-height"]).toBe("44px");
  expect(values(".step-structure-enlarge")).toMatchObject({ width: "44px", height: "44px" });
  expect(values(".step-compound-drawing :deep(.smiles-image-container)").width).toBe("min(320px, 100%)");
  expect(values(".step-compound-drawing :deep(.v-img)")["max-width"]).toBe("100%");
});
