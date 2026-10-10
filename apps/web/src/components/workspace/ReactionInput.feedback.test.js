import { computed, defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ReactionInput from "./ReactionInput.vue";
import { setLocale } from "@/i18n";

// UI/lifecycle fixtures only; the real parser and chemical records are checked in Chrome.
let mockDraft, mockFiles;
jest.mock("@/composables/useReactionDraft", () => ({ useReactionDraft: () => mockDraft }));
jest.mock("@/composables/useReactionFiles", () => ({ useReactionFiles: () => mockFiles }));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ name: "InlineKetcherEditor", template: "<div />" }));
jest.mock("./WorkbenchDialog.vue", () => ({ name: "WorkbenchDialog", template: "<div />" }));
jest.mock("./ReactionRecordPreview.vue", () => ({ name: "ReactionRecordPreview", template: "<div />" }));
const hosts = [], wrappers = [];
const board = defineComponent({ name: "InlineKetcherEditor", setup(_, { expose }) {
  expose({ ready: ref(true), pending: ref(false), busy: ref(false), clearEditor: jest.fn() });
  return () => null;
} });
const stubs = {
  InlineKetcherEditor: board,
  VBtn: { template: '<button type="button"><slot /></button>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VIcon: true, VProgressLinear: true,
  VCard: true, VCardTitle: true, VCardText: true, VCardActions: true, VSpacer: true,
  VSelect: { props: ["modelValue", "items", "menuProps"], emits: ["update:modelValue"],
    template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value=""/><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>' },
};
beforeEach(() => {
  const parsed = ref(null), selected = ref("");
  mockDraft = { parsed, selected, product: computed(() => parsed.value?.products.find(row => row.smiles === selected.value)?.smiles || ""),
    reactants: computed(() => parsed.value?.reactants.map(row => row.smiles) || []), agents: computed(() => parsed.value?.agents || []),
    error: ref(""), pending: ref(false), structurePending: ref(false), loading: ref(false), invalidate: jest.fn() };
  const fileOperation = ref(null);
  mockFiles = { fileBusy: computed(() => fileOperation.value !== null), fileOperation, fileDraft: ref(null), fileProduct: ref(""), fileError: ref(""), fileOrigin: ref("file"),
    discardFile: jest.fn(() => { fileOperation.value = null; mockFiles.fileDraft.value = null; }),
    importFile: jest.fn(), importRecords: jest.fn(), applyFile: jest.fn(), exportFile: jest.fn() };
});
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); hosts.splice(0).forEach(host => host.remove()); });
async function setup(props = {}) {
  const host = document.createElement("div"); document.body.appendChild(host); hosts.push(host);
  const wrapper = mount(ReactionInput, { attachTo: host, props: { id: "reaction-feedback", modelValue: "CCO>>CC=O.C", ...props }, global: { stubs } });
  wrappers.push(wrapper); await flushPromises(); return wrapper;
}
const beforeBoard = (wrapper, element) => Boolean(element.compareDocumentPosition(wrapper.get(".reaction-board").element) & Node.DOCUMENT_POSITION_FOLLOWING);

test("input feedback precedes the drawing and associates current text errors without changing source input", async () => {
  mockDraft.error.value = "反应结构无法解析，请核对画板与反应 SMILES。";
  const wrapper = await setup(), input = wrapper.get("textarea"), feedback = wrapper.get('[role="alert"]');
  expect(beforeBoard(wrapper, feedback.element)).toBe(true);
  expect(input.attributes("aria-invalid")).toBe("true");
  expect(input.attributes("aria-describedby")).toBe(wrapper.get(".reaction-feedback").attributes("id"));
  expect(input.element.value).toBe("CCO>>CC=O.C"); expect(wrapper.emitted("update:modelValue")).toBeUndefined();
});
test("file failures are close to import but do not mark the unchanged reaction text invalid", async () => {
  mockFiles.fileError.value = "服务请求超时，请刷新或重试。";
  const wrapper = await setup();
  expect(beforeBoard(wrapper, wrapper.get('[role="alert"]').element)).toBe(true);
  expect(wrapper.get("textarea").attributes("aria-invalid")).toBeUndefined();
  expect(wrapper.get("textarea").element.value).toBe("CCO>>CC=O.C");
});
test("multiple-product confirmation and incomplete feedback remain beside the input", async () => {
  mockDraft.parsed.value = { reactants: [{ smiles: "CCO" }], agents: [], products: [
    { smiles: "CC=O", index: 1, formula: "protocol", name: "" }, { smiles: "C", index: 2, formula: "protocol", name: "" }] };
  const wrapper = await setup();
  expect(beforeBoard(wrapper, wrapper.get('[data-cy="reaction-product-choice"]').element)).toBe(true);
  expect(beforeBoard(wrapper, wrapper.get(".reaction-incomplete").element)).toBe(true);
  await wrapper.get("select").setValue("C"); expect(mockDraft.selected.value).toBe("C");
  expect(wrapper.find(".reaction-incomplete").exists()).toBe(false);
});

test("the product menu stays in the reaction owner outside the field's contained stacking context", async () => {
  mockDraft.parsed.value = { reactants: [], agents: [], products: [
    { smiles: "CCO", index: 1, formula: "protocol", name: "" }, { smiles: "O", index: 2, formula: "protocol", name: "" }] };
  const wrapper = await setup();
  expect(wrapper.getComponent('[data-cy="reaction-product-choice"]').props("menuProps")?.attach)
    .toBe(wrapper.get(".reaction-input").element);
});
test("RXN processing has a named cancel action; reference transfer keeps its existing parent cancel", async () => {
  mockFiles.fileOperation.value = "import"; const wrapper = await setup();
  expect(wrapper.find('[data-cy="reaction-cancel-file"]').exists()).toBe(true);
  expect(beforeBoard(wrapper, wrapper.get(".reaction-feedback").element)).toBe(true);
  mockFiles.fileOrigin.value = "reference"; await nextTick();
  expect(wrapper.find('[data-cy="reaction-cancel-file"]').exists()).toBe(false);
});

test("export feedback names export and cannot cancel a download through the import action", async () => {
  mockFiles.fileOperation.value = "export";
  const wrapper = await setup();
  expect(wrapper.find('[data-cy="reaction-cancel-file"]').exists()).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toBe("正在导出 RXN 反应");
  wrapper.vm.$.exposed.cancelImport();
  expect(mockFiles.discardFile).not.toHaveBeenCalled();
});
test("explicit file cancel releases controls and returns focus to import without rewriting text", async () => {
  mockFiles.fileOperation.value = "import"; const wrapper = await setup(), cancel = wrapper.get('[data-cy="reaction-cancel-file"]');
  cancel.element.focus(); await cancel.trigger("click"); await flushPromises();
  expect(mockFiles.discardFile).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(wrapper.get('[aria-label="导入 RXN 反应"]').element);
  expect(wrapper.get("textarea").element.value).toBe("CCO>>CC=O.C");
});
test("a cancel continuation cannot take focus from a later control or an inactive input", async () => {
  mockFiles.fileOperation.value = "import"; const wrapper = await setup(), other = document.createElement("button");
  hosts[0].appendChild(other);
  const cancel = wrapper.get('[data-cy="reaction-cancel-file"]'); cancel.element.focus(); cancel.element.click(); other.focus();
  await flushPromises(); expect(document.activeElement).toBe(other);
  mockFiles.fileOperation.value = "import"; await nextTick(); hosts[0].setAttribute("inert", "");
  wrapper.get('[data-cy="reaction-cancel-file"]').element.click(); await flushPromises();
  expect(document.activeElement).toBe(other);
});

test("feedback and cancellation switch languages without rewriting the current reaction", async () => {
  mockFiles.fileOperation.value = "import"; const wrapper = await setup(), original = wrapper.get("textarea").element.value;
  setLocale("en", { persist: false }); await nextTick();
  expect(wrapper.get('[data-cy="reaction-cancel-file"]').attributes("aria-label")).toBe("Cancel RXN import");
  expect(wrapper.get('[role="status"]').text()).toBe("Processing RXN reaction");
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(wrapper.get('[data-cy="reaction-cancel-file"]').attributes("aria-label")).toBe("取消 RXN 导入");
  expect(wrapper.get("textarea").element.value).toBe(original); expect(wrapper.emitted("update:modelValue")).toBeUndefined();
});
