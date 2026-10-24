import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { API } from "@/common/api";
import RouteConditionDialog from "./RouteConditionDialog.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import StructureDrawingDialog from "@/components/workspace/StructureDrawingDialog.vue";
import { provideWorkbenchActivity } from "@/components/workspace/workbench-activity";

jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles", "width", "height", "inputType"], template: '<div :data-reaction="smiles" />',
}));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/views/forward/tab/ConditionRecommendation.vue", () => ({ name: "ConditionRecommendation", template: '<div />' }));

const wrappers = [], controls = [];
const Button = { props: ["disabled"], emits: ["click"],
  template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>' };
const Dialog = defineComponent({ props: ["modelValue"], emits: ["afterLeave"], setup(props, { slots, expose, emit }) {
  const contentEl = ref(null), retained = ref(props.modelValue);
  expose({ contentEl, finishLeave: async () => {
    retained.value = false; await nextTick(); emit("afterLeave");
  } });
  // A real transition retains its closing subtree until actual afterLeave.
  return () => retained.value ? h("div", { ref: contentEl, role: "dialog" }, slots.default?.()) : null;
} });
const stubs = { VBtn: Button, VDefaultsProvider: { props: ["defaults"], template: "<slot />" },
  VTooltip: { props: ["text"], template: '<span><slot name="activator" :props="{}" /></span>' },
  VDialog: Dialog };
function control() {
  const button = document.createElement("button"); document.body.appendChild(button);
  jest.spyOn(button, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  controls.push(button); return button;
}
async function setup(value = { precursors: ["CCO"], product: "CC=O" }) {
  const origin = control(), active = ref(true), reaction = ref(value);
  origin.focus();
  const host = mount(defineComponent({ setup() {
    provideWorkbenchActivity(active);
    return () => h(RouteConditionDialog, { reaction: reaction.value, origin });
  } }), { attachTo: document.body, global: { stubs } });
  wrappers.push(host);
  await flushPromises();
  return { host, wrapper: host.getComponent(RouteConditionDialog), origin, active, reaction };
}
function close(wrapper, mode) {
  const button = wrapper.get('[aria-label="关闭条件预测"]').element;
  button.focus();
  if (mode === "close") button.click();
  else wrapper.findComponent(WorkbenchDialog).vm.$emit("update:modelValue", false);
}
async function inspect(wrapper) {
  const enlarge = wrapper.get('[aria-label="放大反应结构"]').element;
  jest.spyOn(enlarge, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  enlarge.focus(); enlarge.click(); await flushPromises();
  return { enlarge, viewer: wrapper.getComponent(StructureDrawingDialog) };
}
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  controls.splice(0).forEach(element => element.remove()); jest.restoreAllMocks();
});

test.each(["close", "model"])("shared magnifier keeps the whole reaction and nested %s preserves the condition preview", async mode => {
  const post = jest.spyOn(API, "post");
  const { wrapper, origin } = await setup({ precursors: ["CC(=O)O", "CCO"], product: "CCOC(C)=O" });
  const reaction = "CC(=O)O.CCO>>CCOC(C)=O";
  const inline = wrapper.getComponent({ name: "SmilesImage" });
  expect(inline.props()).toMatchObject({ smiles: reaction, inputType: "reaction", width: 620, height: 180 });
  await wrapper.get("select").setValue("5");
  const { enlarge, viewer } = await inspect(wrapper);
  expect(wrapper.findAllComponents({ name: "SmilesImage" }).map(image => image.props("smiles"))).toEqual([reaction, reaction]);
  await viewer.get('[aria-label="放大结构"]').trigger("click");
  expect(viewer.get("output").text()).toBe("125%");
  await viewer.get('[aria-label="结构适应窗口"]').trigger("click");
  expect(viewer.get("output").text()).toBe("100%");
  const closeViewer = viewer.get('[aria-label="关闭结构预览"]').element;
  closeViewer.focus();
  if (mode === "close") closeViewer.click();
  else viewer.getComponent(WorkbenchDialog).vm.$emit("update:modelValue", false);
  await flushPromises();
  await viewer.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave(); await flushPromises();
  expect(document.activeElement).toBe(enlarge);
  expect(wrapper.emitted("close")).toBeUndefined();
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("smiles")).toBe(reaction);
  expect(wrapper.get("select").element.value).toBe("5");
  close(wrapper, "close"); await flushPromises();
  await wrapper.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave(); await flushPromises();
  expect(document.activeElement).toBe(origin);
  expect(post).not.toHaveBeenCalled();
});

test.each(["reaction", "activity", "unmount"])("%s retirement while inspecting cannot return to stale controls", async reason => {
  const post = jest.spyOn(API, "post"), { host, wrapper, origin, reaction, active } = await setup();
  const { enlarge, viewer } = await inspect(wrapper);
  const finishLeave = viewer.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave;
  viewer.get('[aria-label="关闭结构预览"]').element.focus();
  if (reason === "reaction") reaction.value = { precursors: ["C=C"], product: "CCO" };
  if (reason === "activity") active.value = false;
  if (reason === "unmount") host.unmount();
  await flushPromises(); await finishLeave(); await flushPromises();
  expect(document.activeElement).not.toBe(enlarge);
  expect(document.activeElement).not.toBe(origin);
  expect(post).not.toHaveBeenCalled();
});

test.each(["close", "model"])("%s waits for actual leave before restoring its original condition action", async mode => {
  const post = jest.spyOn(API, "post"), { wrapper, origin } = await setup();
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("smiles")).toBe("CCO>>CC=O");
  close(wrapper, mode); await flushPromises();
  expect(wrapper.emitted("close")).toBeUndefined();
  expect(document.activeElement).not.toBe(origin);
  await wrapper.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave(); await flushPromises();
  expect(document.activeElement).toBe(origin);
  expect(wrapper.emitted("close")).toHaveLength(1);
  expect(post).not.toHaveBeenCalled();
});

test("late leave cannot steal a subsequent explicit focus choice", async () => {
  const { wrapper, origin } = await setup(), other = control();
  close(wrapper, "close"); await flushPromises(); other.focus();
  await wrapper.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave(); await flushPromises();
  expect(document.activeElement).toBe(other); expect(document.activeElement).not.toBe(origin);
});

test.each(["reaction", "activity", "unmount"])("%s retirement prevents a stale leave from restoring focus", async reason => {
  const { host, wrapper, origin, active, reaction } = await setup();
  const finishLeave = wrapper.getComponent(WorkbenchDialog).getComponent(Dialog).vm.finishLeave;
  close(wrapper, "close"); await flushPromises();
  if (reason === "reaction") { reaction.value = { precursors: ["C=C"], product: "CCO" }; await flushPromises(); }
  if (reason === "activity") { active.value = false; await flushPromises(); }
  if (reason === "unmount") host.unmount();
  await finishLeave(); await flushPromises();
  expect(document.activeElement).not.toBe(origin);
});

test("closing immediately invalidates a pending prediction before the leave animation", async () => {
  let resolve;
  const post = jest.spyOn(API, "post").mockImplementation(() => new Promise(done => { resolve = done; }));
  const { wrapper } = await setup();
  await wrapper.get(".condition-run-controls button").trigger("click");
  expect(post).toHaveBeenCalledWith("/api/v1/conditions/predict", { reactants: "CCO", product: "CC=O", count: 3 });
  close(wrapper, "close"); await flushPromises();
  expect(wrapper.find('[aria-label="关闭条件预测"]').exists()).toBe(true);
  expect(wrapper.emitted("close")).toBeUndefined();
  resolve({ unexpected: "retired response must not be validated or presented" }); await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.findComponent({ name: "ConditionRecommendation" }).exists()).toBe(false);
  expect(post).toHaveBeenCalledTimes(1);
});
