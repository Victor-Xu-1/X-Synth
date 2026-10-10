const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");
const { mount, flushPromises } = require("@vue/test-utils");
const StructureInput = require("./StructureInput.vue").default;
Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: require("node:crypto").randomUUID });
let mockVisible;
jest.mock("@vueuse/core", () => ({
  useIntersectionObserver: jest.fn((_, callback) => {
    mockVisible = callback;
    return { stop: jest.fn() };
  }),
}));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({
  name: "InlineKetcherEditor",
  props: ["contentChanged", "disabled"],
  data: () => ({ pending: true, busy: false, ready: false }),
  template: '<div class="native-editor" />',
}));
jest.mock("@/components/KetcherModal.vue", () => ({
  name: "KetcherModal",
  props: ["value"],
  emits: ["input"],
  template: "<div />",
}));
jest.mock("./MoleculeFileControls.vue", () => ({
  name: "MoleculeFileControls",
  data: () => ({ hasPending: false }),
  template: "<div />",
}));

test("structure input defaults to an inline board below the compact SMILES field", () => {
  const filename = path.resolve(__dirname, "StructureInput.vue");
  const text = fs.readFileSync(filename, "utf8");
  const { descriptor, errors } = parse(text, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "structure-input" });
  expect(
    compileTemplate({
      filename,
      id: "structure-input",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  expect(text).not.toContain("<details");
  expect(text).not.toContain("<SmilesImage");
  expect(text.indexOf("<textarea")).toBeLessThan(
    text.indexOf("<InlineKetcherEditor"),
  );
  expect(text).toContain('rows="2"');
  expect(text).toContain(':compact="!canvasHeight"');
  expect(text).toContain(':canvas-height="canvasHeight"');
  expect(text).toContain("canvasHeight: { type: Number, default: 0 }");
  expect(text).toContain("auto-sync");
  expect(text).toContain("fill-height");
  expect(text).toContain("useIntersectionObserver");
  expect(text).toContain("editor.value.pending");
  expect(text).toContain(':read-structure="read"');
  expect(script.bindings).toHaveProperty("working");
  expect(text).toContain(':aria-busy="working"');
  expect(text).not.toContain(':aria-busy="pending"');
});

test("the primary target board publishes native edits and exposes input readiness", () => {
  const filename = path.resolve(__dirname, "StructureWorkspace.vue");
  const text = fs.readFileSync(filename, "utf8");
  const { descriptor, errors } = parse(text, { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "target-workspace" });
  expect(script.bindings).toHaveProperty("pending");
  function editor(node) {
    if (node.tag === "InlineKetcherEditor") return node;
    return node.children?.map(editor).find(Boolean);
  }
  expect(editor(descriptor.template.ast).props.some(prop => prop.name === "auto-sync")).toBe(true);
  expect(text).toContain("defineExpose({ read, clear, capture, pending })");
});

describe("unconfirmed input intent", () => {
  let wrapper;
  beforeEach(async () => {
    wrapper = mount(StructureInput, {
      props: { modelValue: "", recycle: true },
      global: { stubs: { VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' }, VBtn: { template: "<button><slot /></button>" } } },
    });
    mockVisible([{ isIntersecting: true }]);
    await flushPromises();
  });
  afterEach(() => wrapper.unmount());

  test("initial empty native loading is pending but has no unconfirmed draft", async () => {
    expect(wrapper.vm.pending).toBe(true);
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(false);
    expect(wrapper.vm.draftRevision).toBe(0);
    const editor = wrapper.getComponent({ name: "InlineKetcherEditor" });
    editor.vm.pending = false;
    editor.vm.ready = true;
    await flushPromises();
    expect(wrapper.vm.pending).toBe(false);
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(false);
  });

  test("native intent survives disabled or hidden input until the actual read settles", async () => {
    const editor = wrapper.getComponent({ name: "InlineKetcherEditor" });
    editor.vm.pending = false;
    editor.vm.ready = true;
    await flushPromises();
    expect(editor.props("contentChanged")).toEqual(expect.any(Function));
    editor.props("contentChanged")();
    editor.vm.pending = true;
    await flushPromises();
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(true);
    expect(wrapper.vm.draftRevision).toBe(1);
    expect(wrapper.props("modelValue")).toBe("");
    await wrapper.setProps({ disabled: true });
    mockVisible([{ isIntersecting: false }]);
    await flushPromises();
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(true);
    expect(wrapper.getComponent({ name: "InlineKetcherEditor" }).vm).toBe(editor.vm);
    editor.vm.pending = false;
    await flushPromises();
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(false);
  });

  test.each(["drawing", "file"])("unconfirmed %s owner protects its input until explicitly cancelled", async owner => {
    const editor = wrapper.getComponent({ name: "InlineKetcherEditor" });
    editor.vm.pending = false;
    await flushPromises();
    const child = wrapper.getComponent({ name: owner === "drawing" ? "KetcherModal" : "MoleculeFileControls" });
    if (owner === "drawing") child.vm.$emit("input", true);
    else child.vm.hasPending = true;
    await flushPromises();
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(true);
    await wrapper.setProps({ disabled: true });
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(true);
    if (owner === "drawing") child.vm.$emit("input", false);
    else child.vm.hasPending = false;
    await flushPromises();
    expect(wrapper.vm.hasUnconfirmedDraft).toBe(false);
  });
});
