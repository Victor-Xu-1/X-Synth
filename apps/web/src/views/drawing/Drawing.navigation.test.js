import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { onBeforeRouteLeave } from "vue-router";
import Drawing from "./Drawing.vue";
import { setLocale } from "@/i18n";

jest.mock("vue-router", () => ({
  useRoute: () => ({ query: {}, path: "/drawing", fullPath: "/drawing", meta: { feature: "drawing" } }),
  onBeforeRouteLeave: jest.fn(),
}));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => ({ can: () => true, refresh: jest.fn() }) }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({ inheritAttrs: false, template: "<slot />" }));
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<div />" }));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ template: "<div />" }));

const filePending = ref(false);
const mockNativeWait = jest.fn();
const Editor = defineComponent({ inheritAttrs: false, props: ["smiles", "contentChanged"], emits: ["update:smiles", "commit"],
  setup(props, { emit, expose }) {
    const publish = value => { emit("update:smiles", value); emit("commit", value); };
    expose({ ready: true, busy: false, pending: false,
      readSmilesFromEditor: async () => { await mockNativeWait(); publish(props.smiles); await nextTick(); return props.smiles; },
      clearEditor: async () => publish("") });
    return () => null;
  } });
const Files = defineComponent({ inheritAttrs: false, setup(_, { expose }) {
  expose({ hasPending: filePending }); return () => null;
} });
let wrapper, confirm;
const from = { fullPath: "/drawing" }, to = { fullPath: "/molcom" };
const guard = () => onBeforeRouteLeave.mock.calls[0]?.[0];
async function setup() {
  wrapper = mount(Drawing, { global: { stubs: {
    InlineKetcherEditor: Editor, MoleculeFileControls: Files, SmilesImage: true,
    VForm: { template: "<form><slot /></form>" }, VIcon: true,
    VTextField: { props: ["modelValue"], emits: ["update:modelValue"],
      template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    VBtn: { template: "<button><slot /></button>" },
    VTooltip: { inheritAttrs: false, template: '<slot name="activator" :props="{}" />' },
  } } });
  await nextTick();
}
beforeEach(() => {
  onBeforeRouteLeave.mockClear(); filePending.value = false;
  mockNativeWait.mockReset().mockResolvedValue(undefined);
  confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  setLocale("en", { persist: false });
});
afterEach(() => { wrapper?.unmount(); wrapper = null; jest.restoreAllMocks(); });

test("clean drawing navigation is allowed without prompting", async () => {
  await setup(); expect(onBeforeRouteLeave).toHaveBeenCalledTimes(1);
  expect(guard()(to, from)).toBe(true); expect(confirm).not.toHaveBeenCalled();
});

test("text and applied structure stay protected until explicit discard", async () => {
  await setup(); const smiles = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  await wrapper.get('[data-cy="draw-enter-smiles"]').setValue(smiles);
  expect(guard()(to, from)).toBe(false);
  await wrapper.get('[data-cy="draw-apply-btn"]').trigger("click"); await flushPromises();
  expect(guard()(to, from)).toBe(false);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe(smiles);
  expect(confirm).toHaveBeenLastCalledWith("Leave and discard the current drawing?");
  confirm.mockReturnValue(true); expect(guard()(to, from)).toBe(true);
});

test("an owned in-flight canvas read cannot be abandoned without confirmation", async () => {
  await setup(); let release;
  mockNativeWait.mockReturnValue(new Promise(resolve => { release = resolve; }));
  await wrapper.get('[data-cy="draw-apply-btn"]').trigger("click");
  expect(guard()(to, from)).toBe(false);
  release(); await flushPromises();
  expect(guard()(to, from)).toBe(true);
});

test("native edits with an unchanged empty SMILES field cannot leave silently", async () => {
  await setup(); wrapper.getComponent(Editor).props("contentChanged")();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("");
  expect(guard()(to, from)).toBe(false);
});

test("unconfirmed file selection is protected even before it changes the canvas", async () => {
  await setup(); filePending.value = true; await nextTick();
  expect(guard()(to, from)).toBe(false);
  filePending.value = false; await nextTick();
  expect(guard()(to, from)).toBe(true);
});

test("explicitly clearing the canvas releases protection after the owned clear completes", async () => {
  await setup(); await wrapper.get('[data-cy="draw-enter-smiles"]').setValue("CCO");
  wrapper.getComponent(Editor).props("contentChanged")();
  await wrapper.get('[aria-label="Clear canvas"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("");
  expect(guard()(to, from)).toBe(true); expect(confirm).not.toHaveBeenCalled();
});

test("local hash focus and language changes do not discard the native draft", async () => {
  await setup(); wrapper.getComponent(Editor).props("contentChanged")();
  expect(guard()({ fullPath: "/drawing#workspace-content" }, from)).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(guard()(to, from)).toBe(false);
  expect(confirm).toHaveBeenLastCalledWith("离开并放弃当前绘图？");
});

test("unload protection is owned and released on disposal", async () => {
  await setup(); wrapper.getComponent(Editor).props("contentChanged")();
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  wrapper.unmount(); wrapper = null;
  const disposed = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(disposed);
  expect(disposed.defaultPrevented).toBe(false);
});
