import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { API } from "@/common/api";
import RouteConditionDialog from "./RouteConditionDialog.vue";
import WorkbenchDialog from "@/components/workspace/WorkbenchDialog.vue";
import { provideWorkbenchActivity } from "@/components/workspace/workbench-activity";

jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage", props: ["smiles"], template: '<div :data-reaction="smiles" />',
}));
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
  VDialog: Dialog };
function control() {
  const button = document.createElement("button"); document.body.appendChild(button);
  jest.spyOn(button, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  controls.push(button); return button;
}
async function setup() {
  const origin = control(), active = ref(true), reaction = ref({ precursors: ["CCO"], product: "CC=O" });
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
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  controls.splice(0).forEach(element => element.remove()); jest.restoreAllMocks();
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
