const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ReactionInput from "./ReactionInput.vue";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import { setLocale } from "@/i18n";

let mockDraft, mockFiles;
const mockActivity = ref(true);
jest.mock("@/composables/useReactionDraft", () => ({ useReactionDraft: () => mockDraft }));
jest.mock("@/composables/useReactionFiles", () => ({ useReactionFiles: () => mockFiles }));
jest.mock("./workbench-activity", () => ({
  ...jest.requireActual("./workbench-activity"), useWorkbenchActivity: () => mockActivity,
}));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ name: "InlineKetcherEditor", template: "<div />" }));
jest.mock("./ReactionRecordPreview.vue", () => ({ name: "ReactionRecordPreview", template: "<div />" }));

// Presentation fixtures only; no chemical parsing or model success is simulated here.
const wrappers = [], elements = [];
const stubs = {
  InlineKetcherEditor: defineComponent({ setup(_, { expose }) {
    expose({ ready: ref(true), pending: ref(false), busy: ref(false) }); return () => null;
  } }),
  VDialog: { props: ["modelValue"], template: '<div v-show="modelValue" role="dialog"><slot /></div>' },
  VDefaultsProvider: { template: '<slot />' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VCard: { template: '<div><slot /></div>' },
  VCardTitle: { props: ["tag"], template: '<component :is="tag || \'div\'"><slot /></component>' },
  VCardText: { template: '<div><slot /></div>' }, VCardActions: { template: '<div><slot /></div>' },
  VSpacer: true, VIcon: true, VSelect: true, VProgressLinear: true,
};
beforeEach(() => {
  mockActivity.value = true;
  mockDraft = { parsed: ref(null), selected: ref(""), product: ref(""), reactants: ref([]), agents: ref([]),
    error: ref(""), pending: ref(false), structurePending: ref(false), loading: ref(false), invalidate: jest.fn() };
  const fileOperation = ref(null), fileDraft = ref(null);
  mockFiles = { fileBusy: computed(() => fileOperation.value !== null), fileOperation, fileDraft,
    fileProduct: ref(""), fileError: ref(""), fileOrigin: ref("file"),
    discardFile: jest.fn(() => { fileOperation.value = null; fileDraft.value = null; }),
    importFile: jest.fn(async () => true), importRecords: jest.fn(async () => true),
    applyFile: jest.fn(() => { fileDraft.value = null; }), exportFile: jest.fn() };
});
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  elements.splice(0).forEach(element => element.remove());
  jest.restoreAllMocks();
});
function setup(props = {}) {
  const wrapper = mount(ReactionInput, { attachTo: document.body,
    props: { id: "rxn-owner", modelValue: "original input", ...props }, global: { stubs } });
  wrappers.push(wrapper);
  jest.spyOn(wrapper.get('input[type="file"]').element, "click").mockImplementation(() => {});
  const origin = wrapper.get('[data-cy="reaction-import-file"]').element;
  jest.spyOn(origin, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  return wrapper;
}
async function open(wrapper) {
  const origin = wrapper.get('[data-cy="reaction-import-file"]').element;
  origin.focus(); origin.click();
  mockFiles.fileDraft.value = { products: [], reaction_smiles: "approved input" };
  await flushPromises();
  const dialog = wrapper.get('[role="dialog"]');
  dialog.element.setAttribute("tabindex", "-1"); dialog.element.focus();
  return origin;
}
async function close(wrapper, method = "button") {
  const dialog = wrapper.getComponent(WorkbenchDialog);
  if (method === "button") {
    const cancel = dialog.findAll("button").find(button => button.text() === "取消");
    cancel.element.focus(); cancel.element.click();
  } else {
    dialog.get('[role="dialog"]').element.setAttribute("tabindex", "-1");
    dialog.get('[role="dialog"]').element.focus();
    dialog.vm.$emit("update:modelValue", false);
  }
  await flushPromises();
  return dialog.vm.$.vnode.props.onAfterLeave;
}

test.each(["ReactionInput.vue", "ReactionRecordPreview.vue"])(
  "%s compiles as a concrete reaction surface",
  (filename) => {
    const source = fs.readFileSync(path.resolve(__dirname, filename), "utf8");
    const { descriptor, errors } = parse(source, { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "reaction-input" });
    expect(
      compileTemplate({
        filename,
        id: "reaction-input",
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
    ).toEqual([]);
  },
);

test("one reaction editor retains native RXN roles and explicit product confirmation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "ReactionInput.vue"),
    "utf8",
  );
  expect(source.match(/<InlineKetcherEditor\b/g)).toHaveLength(1);
  const files = fs.readFileSync(
    path.resolve(__dirname, "../../composables/useReactionFiles.js"),
    "utf8",
  );
  expect(source).not.toContain("<StructureInput");
  expect(files).toContain("checkedReactionDraft");
  expect(files).toContain("await board.value.exportRxn()");
  expect(source).toContain("await board.value.clearEditor()");
  expect(files).toContain("value.products.length === 1");
  expect(source).toContain('data-cy="reaction-product-choice"');
  expect(files).toContain("original !== text.value");
  expect(files).toContain("identities[role]");
  expect(source).not.toMatch(/\.split\(["'](?:>|\.)["']\)/);
});

test("RXN confirmation has a unique heading association that switches language without changing input", async () => {
  const parent = mount({ render: () => h("div", [h(ReactionInput, { id: "first-rxn" }), h(ReactionInput, { id: "second-rxn" })]) }, { global: { stubs } });
  wrappers.push(parent);
  mockFiles.fileDraft.value = { products: [] }; await nextTick();
  const dialogs = parent.findAll('[role="dialog"]');
  expect(dialogs).toHaveLength(2);
  const ids = dialogs.map(dialog => dialog.attributes("aria-labelledby"));
  expect(ids.every(Boolean)).toBe(true); expect(new Set(ids).size).toBe(2);
  for (const language of ["en", "zh-CN"]) {
    setLocale(language, { persist: false }); await nextTick();
    dialogs.forEach((dialog, index) => {
      const title = dialog.get("h2"); expect(title.attributes("id")).toBe(ids[index]);
      expect(title.text()).toBe(language === "en" ? "Confirm reaction file" : "确认反应文件");
    });
  }
  expect(parent.findAllComponents(ReactionInput).every(child => !child.emitted("update:modelValue"))).toBe(true);
});

test.each(["button", "dismiss"])("%s cancellation restores import origin only after the real leave event", async method => {
  const wrapper = setup(), origin = await open(wrapper), leave = await close(wrapper, method);
  expect(document.activeElement).not.toBe(origin);
  expect(wrapper.get("textarea").element.value).toBe("original input");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  expect(typeof leave).toBe("function"); leave(); await flushPromises();
  expect(document.activeElement).toBe(origin);
});

test("a late leave from A cannot restore or consume the newer closed presentation B", async () => {
  const wrapper = setup(); await open(wrapper); const leaveA = await close(wrapper);
  const origin = await open(wrapper), leaveB = await close(wrapper);
  expect(typeof leaveA).toBe("function"); expect(typeof leaveB).toBe("function");
  leaveA(); await flushPromises(); expect(document.activeElement).not.toBe(origin);
  leaveB(); await flushPromises(); expect(document.activeElement).toBe(origin);
});

test.each(["pointerdown", "keydown", "focus"])("new %s intent during closing is not overridden", async intent => {
  const wrapper = setup(), origin = await open(wrapper), leave = await close(wrapper);
  if (intent === "focus") {
    const other = document.createElement("button"); document.body.append(other); elements.push(other); other.focus();
  } else document.dispatchEvent(new Event(intent, { bubbles: true }));
  expect(typeof leave).toBe("function"); leave(); await flushPromises();
  expect(document.activeElement).not.toBe(origin);
});

test.each(["modelValue", "id", "disabled", "activity", "unmount", "hidden", "inert", "detached"])(
  "%s invalidation prevents a pending RXN close from returning focus", async reason => {
    const wrapper = setup(), origin = await open(wrapper), leave = await close(wrapper);
    if (reason === "modelValue") await wrapper.setProps({ modelValue: "new input" });
    else if (reason === "id") await wrapper.setProps({ id: "next-owner" });
    else if (reason === "disabled") await wrapper.setProps({ disabled: true });
    else if (reason === "activity") { mockActivity.value = false; await nextTick(); }
    else if (reason === "unmount") wrapper.unmount();
    else if (reason === "hidden") origin.hidden = true;
    else if (reason === "inert") origin.setAttribute("inert", "");
    else origin.remove();
    expect(typeof leave).toBe("function"); leave(); await flushPromises();
    expect(document.activeElement).not.toBe(origin);
  },
);

test("workbench hiding preserves the file preview without retaining stale return focus", async () => {
  const wrapper = setup(), origin = await open(wrapper), dialog = wrapper.getComponent(WorkbenchDialog);
  mockActivity.value = false; await flushPromises();
  expect(mockFiles.discardFile).not.toHaveBeenCalled(); expect(mockFiles.fileDraft.value).not.toBeNull();
  origin.click(); expect(wrapper.get('input[type="file"]').element.click).toHaveBeenCalledTimes(1);
  mockActivity.value = true; await flushPromises();
  expect(dialog.props("modelValue")).toBe(true);
  const leave = await close(wrapper);
  expect(typeof leave).toBe("function"); leave();
  expect(document.activeElement).not.toBe(origin);
});

test("an approved apply returns focus after leave even when the controlled model updates on the next render", async () => {
  const wrapper = setup(), origin = await open(wrapper), dialog = wrapper.getComponent(WorkbenchDialog);
  mockFiles.applyFile.mockImplementation(() => {
    wrapper.setProps({ modelValue: "approved input" }); mockFiles.fileDraft.value = null;
  });
  const apply = dialog.findAll("button").find(button => button.text() === "应用反应");
  apply.element.focus(); apply.element.click(); await flushPromises();
  expect(wrapper.get("textarea").element.value).toBe("approved input");
  expect(document.activeElement).not.toBe(origin);
  const leave = dialog.vm.$.vnode.props.onAfterLeave;
  expect(typeof leave).toBe("function"); leave(); await flushPromises();
  expect(document.activeElement).toBe(origin);
});

test("an obsolete failed file read cannot consume the newer preview's return focus", async () => {
  let settle;
  mockFiles.importFile.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const wrapper = setup(), origin = wrapper.get('[data-cy="reaction-import-file"]').element;
  origin.focus(); origin.click(); await wrapper.get('input[type="file"]').trigger("change");
  await open(wrapper); const leave = await close(wrapper);
  settle(false); await flushPromises();
  leave(); await flushPromises(); expect(document.activeElement).toBe(origin);
});

test("reference confirmation is named and returns to the actual reference origin after leave", async () => {
  const wrapper = setup(), origin = document.createElement("button");
  document.body.append(origin); elements.push(origin);
  jest.spyOn(origin, "getClientRects").mockReturnValue([{ width: 44, height: 44 }]);
  origin.focus();
  mockFiles.importRecords.mockImplementation(async () => {
    mockFiles.fileOrigin.value = "reference"; mockFiles.fileDraft.value = { products: [] }; return true;
  });
  await wrapper.vm.$.exposed.importRecords({}); await flushPromises();
  const dialog = wrapper.get('[role="dialog"]');
  expect(dialog.get("h2").text()).toBe("确认参考反应");
  expect(dialog.attributes("aria-labelledby")).toBe(dialog.get("h2").attributes("id"));
  const leave = await close(wrapper); leave(); await flushPromises();
  expect(document.activeElement).toBe(origin);
});
