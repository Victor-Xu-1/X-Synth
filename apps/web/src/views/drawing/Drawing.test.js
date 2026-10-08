import { defineComponent, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import Drawing from "./Drawing.vue";
import { API } from "@/common/api";

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
const picker = defineComponent({ name: "MoleculeFileControls", emits: ["busy", "import"],
  setup(_, { expose }) { const hasPending = ref(false); expose({ hasPending }); return { selected: ref("unconfirmed_salt"), hasPending }; },
  template: '<div><input v-model="selected" aria-label="Test-only retained file choice" /><input v-model="hasPending" type="checkbox" aria-label="Test-only file confirmation pending" /></div>' });
const editor = defineComponent({ name: "InlineKetcherEditor", props: ["smiles"],
  setup(_, { expose }) { expose({ readSmilesFromEditor: mockReadDrawing }); return { marker: ref("unconfirmed_editor_state") }; }, template: '<input v-model="marker" aria-label="Test-only retained drawing state" />' });
const stubs = {
  VDefaultsProvider: { props: ["defaults"], template: "<slot />" }, VForm: { template: "<form><slot /></form>" },
  VTextField: { props: ["modelValue"], template: '<input :value="modelValue" />' },
  VBtn: { template: '<button><slot /></button>' }, VTooltip: { inheritAttrs: false, template: '<slot name="activator" :props="{}" />' },
  VIcon: true, VProgressLinear: true, RouterLink: true, InlineKetcherEditor: editor,
  SmilesImage: true, MoleculeFileControls: picker,
};
beforeEach(() => { mockAllowed.value = true; mockWorkspace.loading = false; mockWorkspace.error = "";
  mockReadDrawing.mockReset().mockResolvedValue("CCO"); API.post.mockReset().mockResolvedValue({ smiles: "CCO" });
  API.toErrorObject.mockReturnValue({ string_error: "read error" }); crypto.randomUUID = jest.fn(() => "drawing-instance"); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
function setup() { wrapper = mount(Drawing, { global: { stubs } }); }

test("a recoverable gateway outage keeps the same pending file and drawing children behind the shared gate", async () => {
  setup();
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
  setup(); const oldEditor = wrapper.getComponent(editor).vm.$.uid;
  mockWorkspace.loading = true; await nextTick();
  expect(wrapper.getComponent(editor).vm.$.uid).toBe(oldEditor);
  expect(wrapper.get(".drawing-layout").isVisible()).toBe(true);
  expect(wrapper.text()).not.toContain("连接结构服务");
});

test("an unconfirmed file record cannot apply or standardize the older displayed structure", async () => {
  setup(); await wrapper.get('[aria-label="Test-only file confirmation pending"]').setValue(true);
  await wrapper.get('[data-cy="draw-apply-btn"]').trigger("click");
  await wrapper.get('[data-cy="draw-canonicalize-btn"]').trigger("click");
  expect(mockReadDrawing).not.toHaveBeenCalled(); expect(API.post).not.toHaveBeenCalled();
});
