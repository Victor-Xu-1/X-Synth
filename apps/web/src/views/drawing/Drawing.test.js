import { defineComponent, nextTick, reactive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Drawing from "./Drawing.vue";
import { API } from "@/common/api";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";

const mockAllowed = ref(true);
const mockWorkspace = reactive({ loading: false, refreshed: 1, error: "",
  can: () => mockAllowed.value, checking: () => false, refresh: jest.fn() });
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: () => mockWorkspace }));
jest.mock("vue-router", () => ({ useRoute: () => ({ path: "/drawing", meta: { feature: "drawing" }, query: { smiles: "[Na+].CC(=O)[O-]" } }) }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn(), toErrorObject: jest.fn() } }));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ name: "InlineKetcherEditor", template: "<div />" }));
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ name: "MoleculeFileControls", template: "<div />" }));
let wrapper;
const mockReadDrawing = jest.fn();
const mockWriteDrawing = jest.fn();
const mockClearDrawing = jest.fn();
const picker = defineComponent({ name: "MoleculeFileControls", emits: ["busy", "import"],
  setup(_, { expose }) { const hasPending = ref(false); expose({ hasPending }); return { selected: ref("unconfirmed_salt"), hasPending }; },
  template: '<div><input v-model="selected" aria-label="Test-only retained file choice" /><input v-model="hasPending" type="checkbox" aria-label="Test-only file confirmation pending" /></div>' });
const editor = defineComponent({ name: "InlineKetcherEditor", props: ["smiles"],
  emits: ["update:smiles", "commit"],
  setup(_, { expose, emit }) {
    const ready = ref(true), busy = ref(false), error = ref(""), pending = ref(false);
    const readSmilesFromEditor = async () => {
      const value = await mockReadDrawing();
      if (typeof value === "string") {
        emit("update:smiles", value.trim());
        emit("commit", value.trim());
        await nextTick();
      }
      return value;
    };
    const clearEditor = async () => {
      await mockClearDrawing();
      error.value = ""; pending.value = false;
      emit("update:smiles", ""); emit("commit", "");
    };
    expose({ readSmilesFromEditor, setSmilesToEditor: mockWriteDrawing, clearEditor,
      ready, busy, error, pending });
    return { marker: ref("unconfirmed_editor_state") };
  }, template: '<input v-model="marker" aria-label="Test-only retained drawing state" />' });
const stubs = {
  VDefaultsProvider: { props: ["defaults"], template: "<slot />" }, VForm: { template: "<form><slot /></form>" },
  VTextField: { props: ["modelValue"], emits: ["update:modelValue"],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  VBtn: { template: '<button><slot /></button>' }, VTooltip: { inheritAttrs: false, template: '<slot name="activator" :props="{}" />' },
  VIcon: true, VProgressLinear: true, RouterLink: true, InlineKetcherEditor: editor,
  SmilesImage: true, MoleculeFileControls: picker,
};
beforeEach(() => { mockAllowed.value = true; mockWorkspace.loading = false; mockWorkspace.error = "";
  mockReadDrawing.mockReset().mockResolvedValue("CCO"); API.post.mockReset().mockResolvedValue({ smiles: "CCO" });
  mockWriteDrawing.mockReset().mockResolvedValue(true);
  mockClearDrawing.mockReset().mockResolvedValue(undefined);
  API.toErrorObject.mockReturnValue({ string_error: "read error" }); crypto.randomUUID = jest.fn(() => "drawing-instance"); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
async function setup() { wrapper = mount(Drawing, { global: { stubs } });  await nextTick(); }

test("English-default drawing copy preserves the mounted editor and pending file state when returning to Chinese", async () => {
  await setup(); const editorUid = wrapper.getComponent(editor).vm.$.uid, pickerUid = wrapper.getComponent(picker).vm.$.uid;
  await wrapper.get('[aria-label="Test-only retained drawing state"]').setValue("[13CH3][C@H]([NH3+])CO.[Cl-]");
  setLocale(DEFAULT_LOCALE, { persist: false }); await nextTick();
  expect(wrapper.text()).toContain("Structure drawing"); expect(wrapper.text()).toContain("Canonicalize");
  expect(wrapper.getComponent(editor).vm.$.uid).toBe(editorUid); expect(wrapper.getComponent(picker).vm.$.uid).toBe(pickerUid);
  expect(wrapper.get('[aria-label="Test-only retained drawing state"]').element.value).toContain("[Cl-]");
  expect(mockReadDrawing).not.toHaveBeenCalled(); expect(API.post).not.toHaveBeenCalled();
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(wrapper.text()).toContain("结构绘制"); expect(wrapper.getComponent(editor).vm.$.uid).toBe(editorUid);
});

test("drawing status and read failure translate at display time without changing the applied chemical identity", async () => {
  await setup();
  const smiles = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  wrapper.getComponent(editor).vm.$emit("commit", smiles); await nextTick();
  setLocale(DEFAULT_LOCALE, { persist: false }); await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("Structure applied.");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe(smiles);
  mockReadDrawing.mockResolvedValue(null);
  await wrapper.get('[data-cy="draw-apply-btn"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("Could not read the structure. Check the canvas and editor status.");
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(wrapper.get('[role="alert"]').text()).toBe("无法读取结构，请检查画板内容与绘制器状态。");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe(smiles); expect(API.post).not.toHaveBeenCalled();
});

test("a recoverable gateway outage keeps the same pending file and drawing children behind the shared gate", async () => {
  await setup();
  const oldPicker = wrapper.getComponent(picker).vm.$.uid, oldEditor = wrapper.getComponent(editor).vm.$.uid;
  await wrapper.get('[aria-label="Test-only retained file choice"]').setValue("chosen_full_salt");
  await wrapper.get('[aria-label="Test-only retained drawing state"]').setValue("unconfirmed_chiral_drawing");
  mockAllowed.value = false; mockWorkspace.error = "gateway unavailable"; await nextTick();
  expect(wrapper.getComponent(picker).vm.$.uid).toBe(oldPicker);
  expect(wrapper.getComponent(editor).vm.$.uid).toBe(oldEditor);
  expect(wrapper.get(".drawing-layout").isVisible()).toBe(false);
  mockAllowed.value = true; mockWorkspace.error = ""; await nextTick();
  expect(wrapper.get('[aria-label="Test-only retained file choice"]').element.value).toBe("chosen_full_salt");
  expect(wrapper.get('[aria-label="Test-only retained drawing state"]').element.value).toBe("unconfirmed_chiral_drawing");
});

test("unrelated background loading preserves the initialized drawing and never adds a competing status pane", async () => {
  await setup(); const oldEditor = wrapper.getComponent(editor).vm.$.uid;
  mockWorkspace.loading = true; await nextTick();
  expect(wrapper.getComponent(editor).vm.$.uid).toBe(oldEditor);
  expect(wrapper.get(".drawing-layout").isVisible()).toBe(true);
  expect(wrapper.text()).not.toContain("连接结构服务");
});

test("an unconfirmed file record cannot apply or standardize the older displayed structure", async () => {
  await setup(); await wrapper.get('[aria-label="Test-only file confirmation pending"]').setValue(true);
  await wrapper.get('[data-cy="draw-apply-btn"]').trigger("click");
  await wrapper.get('[data-cy="draw-canonicalize-btn"]').trigger("click");
  expect(mockReadDrawing).not.toHaveBeenCalled(); expect(API.post).not.toHaveBeenCalled();
});

function failedEditor() {
  const state = wrapper.getComponent(editor).vm.$.exposed;
  state.pending.value = true;
  state.error.value = "Structure import failed";
  return state;
}

test("an ordinary import failure allows text correction but still blocks unconfirmed reads and execution", async () => {
  await setup(); failedEditor(); await nextTick();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.disabled).toBe(false);
  expect(wrapper.get('[aria-label="清空画板"]').element.disabled).toBe(false);
  expect(wrapper.get('[data-cy="draw-apply-btn"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="draw-canonicalize-btn"]').element.disabled).toBe(true);
  await wrapper.get('[data-cy="draw-enter-smiles"]').setValue("CCN");
  expect(wrapper.vm.$.setupState.smiles).toBe("CCN");
  await wrapper.vm.$.setupState.applyStructure();
  await wrapper.vm.$.setupState.canonicalize();
  expect(mockReadDrawing).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});

test("clear recovers an ordinary failed import through the owned native writer, not a text fallback", async () => {
  await setup(); seedAppliedStructure(); failedEditor(); await nextTick();
  await wrapper.vm.$.setupState.clearEditor(); await flushPromises();
  expect(mockClearDrawing).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("");
  expect(wrapper.find('[data-cy="draw-committed-smiles"]').exists()).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toBe("画板已清空。");
  expect(mockReadDrawing).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});

test("an unconfirmed file selection blocks correction and clear even when the editor also has an error", async () => {
  await setup(); failedEditor();
  await wrapper.get('[aria-label="Test-only file confirmation pending"]').setValue(true);
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="清空画板"]').element.disabled).toBe(true);
  await wrapper.vm.$.setupState.clearEditor();
  expect(mockClearDrawing).not.toHaveBeenCalled();
});

test.each([
  { ready: true, busy: true, error: "Structure import failed" },
  { ready: false, busy: false, error: "" },
])("unsafe editor state %p keeps text, clear and execution blocked", async state => {
  await setup(); const exposed = failedEditor();
  Object.entries(state).forEach(([key, value]) => { exposed[key].value = value; });
  await nextTick();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="清空画板"]').element.disabled).toBe(true);
  await wrapper.vm.$.setupState.clearEditor();
  await wrapper.vm.$.setupState.applyStructure();
  await wrapper.vm.$.setupState.canonicalize();
  expect(mockClearDrawing).not.toHaveBeenCalled();
  expect(mockReadDrawing).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});

test("an interrupted editor permits correcting reload text but cannot clear or read its quarantined canvas", async () => {
  await setup(); const exposed = failedEditor(); exposed.ready.value = false; await nextTick();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.disabled).toBe(false);
  expect(wrapper.get('[aria-label="清空画板"]').element.disabled).toBe(true);
  await wrapper.vm.$.setupState.clearEditor();
  await wrapper.vm.$.setupState.applyStructure();
  await wrapper.vm.$.setupState.canonicalize();
  expect(mockClearDrawing).not.toHaveBeenCalled();
  expect(mockReadDrawing).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("standardization reads the live canvas and publishes only after a confirmed write and readback", async () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const source = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  const normalized = "[Cl-].[13CH3][C@H]([NH3+])CO";
  const writing = deferred();
  mockReadDrawing.mockResolvedValueOnce(source).mockResolvedValueOnce(normalized);
  API.post.mockResolvedValue({ smiles: normalized });
  mockWriteDrawing.mockReturnValue(writing.promise);
  await setup();
  await nextTick();
  await wrapper.get('[data-cy="draw-canonicalize-btn"]').trigger("click");
  await flushPromises();
  expect(mockReadDrawing).toHaveBeenCalledTimes(1);
  expect(API.post.mock.calls[0].slice(0, 2)).toEqual(["/api/rdkit/canonicalize", { smiles: source }]);
  expect(mockWriteDrawing).toHaveBeenCalledWith(normalized);
  expect(wrapper.find('[data-cy="draw-committed-smiles"]').exists()).toBe(false);
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  writing.resolve(true);
  await flushPromises();
  expect(mockReadDrawing).toHaveBeenCalledTimes(2);
  expect(mockWriteDrawing).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe(normalized);
  expect(wrapper.get('[role="status"]').text()).toBe("Structure canonicalized.");
});

async function standardize() {
  await nextTick();
  await wrapper.get('[data-cy="draw-canonicalize-btn"]').trigger("click");
  await flushPromises();
}

function seedAppliedStructure() {
  wrapper.getComponent(editor).vm.$emit("commit", "CCC");
}

test("a fresh nonempty canvas can be standardized while the raw text is empty", async () => {
  mockReadDrawing.mockResolvedValue("CCN");
  API.post.mockResolvedValue({ smiles: "CCN" });
  await setup();
  wrapper.getComponent(editor).vm.$emit("update:smiles", "");
  await nextTick();
  expect(wrapper.get('[data-cy="draw-canonicalize-btn"]').element.disabled).toBe(false);
  await standardize();
  expect(API.post.mock.calls[0].slice(0, 2)).toEqual(["/api/rdkit/canonicalize", { smiles: "CCN" }]);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCN");
});

test.each([null, undefined, "", " \n", 7])("an invalid canvas snapshot %p never falls back to text", async snapshot => {
  mockReadDrawing.mockResolvedValue(snapshot);
  await setup(); seedAppliedStructure();
  await standardize();
  expect(API.post).not.toHaveBeenCalled();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
});

test("a rejected canvas read preserves the last applied structure and prevents the request", async () => {
  mockReadDrawing.mockRejectedValue(new Error("native read failed"));
  await setup(); seedAppliedStructure();
  await standardize();
  expect(API.post).not.toHaveBeenCalled();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
});

test.each([{}, { smiles: "" }, { smiles: " " }, { smiles: 7 }])(
  "an invalid normalized response %p is not imported or claimed as applied", async response => {
    API.post.mockResolvedValue(response);
    await setup(); seedAppliedStructure();
    await standardize();
    expect(mockWriteDrawing).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe("read error");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
  },
);

test.each([false, undefined])("an unconfirmed native write %p cannot publish normalized success", async applied => {
  mockWriteDrawing.mockResolvedValue(applied);
  await setup(); seedAppliedStructure();
  await standardize();
  expect(mockReadDrawing).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
});

test("a failed native write retains the source snapshot and the prior applied preview", async () => {
  mockReadDrawing.mockResolvedValue("CCN");
  mockWriteDrawing.mockRejectedValue(new Error("native import failed"));
  await setup(); seedAppliedStructure();
  await standardize();
  expect(mockReadDrawing).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("CCN");
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
});

test("a failed readback does not mark a completed write as an applied normalized structure", async () => {
  mockReadDrawing.mockResolvedValueOnce("CCN").mockResolvedValueOnce(null);
  await setup(); seedAppliedStructure();
  await standardize();
  expect(mockWriteDrawing).toHaveBeenCalledTimes(1);
  expect(mockReadDrawing).toHaveBeenCalledTimes(2);
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
});

test("a request failure retains the live snapshot without rewriting the canvas", async () => {
  mockReadDrawing.mockResolvedValue("CCN");
  API.post.mockRejectedValue(new Error("canonicalize unavailable"));
  await setup(); seedAppliedStructure();
  await standardize();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("CCN");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
  expect(wrapper.get('[role="alert"]').text()).toBe("read error");
});

test("pending native input blocks both the control and its handler", async () => {
  await setup();
  wrapper.getComponent(editor).vm.$.exposed.pending.value = true;
  await nextTick();
  expect(wrapper.get('[data-cy="draw-canonicalize-btn"]').element.disabled).toBe(true);
  await wrapper.vm.$.setupState.canonicalize();
  expect(mockReadDrawing).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
});

test("repeated clicks cannot start a competing normalization while the write is pending", async () => {
  const writing = deferred();
  mockWriteDrawing.mockReturnValue(writing.promise);
  await setup();
  await standardize();
  expect(wrapper.get('[data-cy="draw-canonicalize-btn"]').element.disabled).toBe(true);
  await wrapper.vm.$.setupState.canonicalize();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(mockWriteDrawing).toHaveBeenCalledTimes(1);
  writing.resolve(true); await flushPromises();
  expect(mockReadDrawing).toHaveBeenCalledTimes(2);
});

test("a response for a superseded snapshot cannot write over a newer field", async () => {
  const response = deferred();
  API.post.mockReturnValue(response.promise);
  await setup(); seedAppliedStructure();
  await standardize();
  wrapper.getComponent(editor).vm.$emit("update:smiles", "CCN");
  await nextTick();
  response.resolve({ smiles: "CCO" }); await flushPromises();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("CCN");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});

test("leaving while the live read is pending prevents any subsequent request or write", async () => {
  const reading = deferred();
  mockReadDrawing.mockReturnValue(reading.promise);
  await setup();
  await standardize();
  wrapper.unmount(); wrapper = undefined;
  reading.resolve("CCN"); await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
});

test("leaving cancels the bounded request and ignores its late result", async () => {
  const response = deferred();
  API.post.mockReturnValue(response.promise);
  await setup();
  await standardize();
  const options = API.post.mock.calls[0][3];
  expect(options.timeoutMs).toBe(15000);
  expect(options.signal.aborted).toBe(false);
  wrapper.unmount(); wrapper = undefined;
  expect(options.signal.aborted).toBe(true);
  response.resolve({ smiles: "CCN" }); await flushPromises();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
});

test("lost drawing authority retires a request even if the workbench recovers before its response", async () => {
  const response = deferred();
  API.post.mockReturnValue(response.promise);
  await setup(); seedAppliedStructure();
  await standardize();
  const options = API.post.mock.calls[0][3];
  mockAllowed.value = false; await nextTick();
  mockAllowed.value = true; await nextTick();
  expect(options.signal.aborted).toBe(true);
  response.resolve({ smiles: "CCN" }); await flushPromises();
  expect(mockWriteDrawing).not.toHaveBeenCalled();
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
});

test("a write retired by newer input cannot read back or claim the old normalized result", async () => {
  const writing = deferred();
  mockWriteDrawing.mockReturnValue(writing.promise);
  await setup(); seedAppliedStructure();
  await standardize();
  wrapper.getComponent(editor).vm.$emit("update:smiles", "CCN");
  await nextTick();
  writing.resolve(false); await flushPromises();
  expect(mockReadDrawing).toHaveBeenCalledTimes(1);
  expect(wrapper.get('[data-cy="draw-enter-smiles"]').element.value).toBe("CCN");
  expect(wrapper.get('[data-cy="draw-committed-smiles"]').text()).toBe("CCC");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

test("a write that settles after disposal cannot read back or publish normalized success", async () => {
  const writing = deferred();
  mockWriteDrawing.mockReturnValue(writing.promise);
  await setup(); seedAppliedStructure();
  await standardize();
  const state = wrapper.vm.$.setupState;
  wrapper.unmount(); wrapper = undefined;
  writing.resolve(true); await flushPromises();
  expect(mockReadDrawing).toHaveBeenCalledTimes(1);
  expect(state.committedSmiles).toBe("CCC");
  expect(state.notice).toBe("");
});
