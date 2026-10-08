import { mount, flushPromises } from "@vue/test-utils";
import { TextDecoder } from "util";
import { nextTick } from "vue";
import { setLocale } from "@/i18n";
import WorkbenchDialog from "./WorkbenchDialog.vue";
import MoleculeFileControls from "./MoleculeFileControls.vue";
import { API } from "@/common/api";
import { downloadChemicalFile } from "@/common/chemical-files";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  template: "<div />",
}));
jest.mock("@/common/chemical-files", () => ({
  ...jest.requireActual("@/common/chemical-files"),
  downloadChemicalFile: jest.fn(),
}));
const record = {
  index: 1,
  name: "Compound",
  smiles: "CCO",
  atoms: 3,
  components: 1,
  formula: "C2H6O",
  molecular_weight: 46.069,
};
const slot = {
  template: '<div><slot /><slot name="activator" :props="{}" /></div>',
};
const stubs = {
  VTooltip: slot,
  VMenu: slot,
  VList: slot,
  VListItem: { props: ["title"], template: "<button>{{ title }}</button>" },
  VBtn: {
    props: ["disabled"],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  VDialog: {
    props: ["modelValue"],
    template: '<section v-if="modelValue"><slot /></section>',
  },
  VCard: slot,
  VCardTitle: slot,
  VCardSubtitle: slot,
  VCardText: slot,
  VCardActions: slot,
  VSpacer: true,
  VProgressCircular: true,
  VRadioGroup: { ...slot, name: "VRadioGroup" },
  VRadio: { props: ["value", "label"], template: '<label>{{ label }}</label>' },
  VPagination: { name: "VPagination", props: ["modelValue"], emits: ["update:modelValue"], template: "<div />" },
  VIcon: true,
  SmilesImage: true,
};
let wrappers = [];
function make(props = {}) {
  const wrapper = mount(MoleculeFileControls, { props, attachTo: document.body, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function upload(wrapper, file = {
  name: "compound.sdf",
  size: 3,
  arrayBuffer: async () => Uint8Array.of(67, 67, 79).buffer,
}) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
  await flushPromises();
}
function button(wrapper, title) {
  return wrapper.findAll("button").find((value) => value.text() === title);
}
beforeEach(() => {
  global.TextDecoder = TextDecoder;
  jest.clearAllMocks();
  API.post.mockReset();
});
afterEach(() => {
  wrappers.forEach((wrapper) => { wrapper.unmount(); wrapper.element.remove(); });
  wrappers = [];
});
test("even a single parsed record is previewed and requires explicit application", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make();
  await upload(wrapper);
  expect(wrapper.text()).toContain("选择化合物");
  expect(wrapper.emitted("import")).toBeUndefined();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "应用结构")
    .trigger("click");
  expect(wrapper.emitted("import")[0]).toEqual([record]);
});
test("multiple records are not silently reduced to the first", async () => {
  API.post.mockResolvedValue({
    format: "sdf",
    records: [record, { ...record, index: 2 }],
  });
  const wrapper = make();
  await upload(wrapper);
  expect(
    wrapper
      .findAll("button")
      .find((button) => button.text() === "应用结构")
      .attributes("disabled"),
  ).toBeDefined();
});
test("late import response cannot overwrite a changed chemical input", async () => {
  const task = deferred();
  API.post.mockReturnValue(task.promise);
  const wrapper = make({ smiles: "CCO" });
  await upload(wrapper);
  await wrapper.setProps({ smiles: "CCN" });
  task.resolve({ format: "sdf", records: [record] });
  await flushPromises();
  expect(wrapper.text()).not.toContain("选择化合物");
  expect(wrapper.emitted("import")).toBeUndefined();
});
test("export reads the current drawing, not a stale SMILES field", async () => {
  const read = jest.fn();
  const wrapper = make({ smiles: "CCO", readStructure: read });
  read.mockImplementation(async () => {
    await wrapper.setProps({ smiles: "CCN" });
    await nextTick();
    return "CCN";
  });
  API.post.mockResolvedValue({ valid: true, smiles: "CCN", atoms: 3, format: "mol", content: "chemical file" });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "MOL 结构")
    .trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/structure/export", {
    smiles: "CCN",
    format: "mol",
    name: "",
  }, false, { signal: expect.any(AbortSignal), timeoutMs: 15000 });
  expect(downloadChemicalFile).toHaveBeenCalledTimes(1);
});
test("changed input after export starts invalidates the download", async () => {
  const task = deferred();
  API.post.mockReturnValue(task.promise);
  const wrapper = make({ smiles: "CCO" });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "MOL 结构")
    .trigger("click");
  await flushPromises();
  await wrapper.setProps({ smiles: "CCN" });
  task.resolve({ format: "mol", content: "old structure" });
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
});

test("existing structure requires a separate old-to-new confirmation, and cancel preserves it", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const read = jest.fn().mockResolvedValue("CCN");
  const wrapper = make({ smiles: "CCN", readStructure: read });
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  await flushPromises();
  expect(read).not.toHaveBeenCalled();
  expect(wrapper.emitted("import")).toBeUndefined();
  expect(wrapper.get(".replacement-preview").text()).toContain("CCN");
  expect(wrapper.get(".replacement-preview").text()).toContain("CCO");
  expect(wrapper.vm.hasPending).toBe(true);
  await button(wrapper, "取消").trigger("click");
  expect(wrapper.emitted("import")).toBeUndefined();
  expect(wrapper.props("smiles")).toBe("CCN");
  expect(wrapper.vm.hasPending).toBe(false);
});

test("replacement applies exactly the selected full record only after confirmation", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make({ smiles: "CCN" });
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  await flushPromises();
  await button(wrapper, "确定").trigger("click");
  expect(wrapper.emitted("import")).toEqual([[record]]);
  expect(wrapper.vm.hasPending).toBe(false);
});

test("export cannot consume an unconfirmed picker, even via its command handler", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make({ smiles: "CCN" });
  await upload(wrapper);
  await button(wrapper, "MOL 结构").trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(wrapper.vm.hasPending).toBe(true);
});

test("unsupported file errors translate while the file name stays raw", async () => {
  setLocale("en", { persist: false });
  const wrapper = make();
  await upload(wrapper, { name: "取消.cdx", size: 3 });
  expect(wrapper.get('[role="alert"]').text()).toContain("Select a MOL, SDF or SMILES");
  expect(API.post).not.toHaveBeenCalled();
});

test("source callback or name changes invalidate a deferred export", async () => {
  const task = deferred();
  API.post.mockReturnValue(task.promise);
  const wrapper = make({ smiles: "CCO", name: "old" });
  await button(wrapper, "MOL 结构").trigger("click");
  await flushPromises();
  await wrapper.setProps({ name: "new", readStructure: async () => "CCN" });
  task.resolve({ format: "mol", content: "old structure" });
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(wrapper.vm.hasPending).toBe(false);
});

test("a stale drawing read cannot override a newer input", async () => {
  const task = deferred();
  const wrapper = make({ smiles: "CCO", readStructure: () => task.promise });
  await button(wrapper, "MOL 结构").trigger("click");
  expect(wrapper.vm.readingStructure).toBe(true);
  await wrapper.setProps({ smiles: "CCN" });
  task.resolve("CCO");
  await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  expect(wrapper.vm.hasPending).toBe(false);
});

test("picker Escape abandons every staged record", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make();
  await upload(wrapper);
  wrapper.findAllComponents(WorkbenchDialog)[0].vm.$emit("update:modelValue", false);
  await nextTick();
  expect(wrapper.vm.hasPending).toBe(false);
  expect(wrapper.emitted("import")).toBeUndefined();
});

test("a selected off-page record remains explicit, with its full identity and raw bilingual name", async () => {
  const records = Array.from({ length: 7 }, (_, index) => ({ ...record, index: index + 1,
    name: index === 6 ? "取消-样品 β" : `Sample ${index + 1}`,
    smiles: index === 6 ? "[13CH3][C@H]([NH3+])CO.[Cl-]" : "CCO" }));
  API.post.mockResolvedValue({ format: "sdf", records });
  const wrapper = make();
  await upload(wrapper);
  wrapper.findComponent({ name: "VPagination" }).vm.$emit("update:modelValue", 2);
  await nextTick();
  wrapper.findComponent({ name: "VRadioGroup" }).vm.$emit("update:modelValue", 7);
  await nextTick();
  setLocale("en", { persist: false });
  await nextTick();
  expect(wrapper.text()).toContain("取消-样品 β");
  expect(wrapper.text()).toContain("[13CH3][C@H]([NH3+])CO.[Cl-]");
  wrapper.findComponent({ name: "VPagination" }).vm.$emit("update:modelValue", 1);
  await nextTick();
  expect(wrapper.get(".selected-record").text()).toContain("取消-样品 β");
  await button(wrapper, "Apply structure").trigger("click");
  await flushPromises();
  expect(wrapper.emitted("import")).toEqual([[records[6]]]);
});

test("cancelling a deferred host read prevents any parser request and allows a fresh upload", async () => {
  const read = deferred();
  const wrapper = make();
  await upload(wrapper, { name: "pending.sdf", size: 3, arrayBuffer: () => read.promise });
  expect(wrapper.vm.hasPending).toBe(true);
  await wrapper.get('[aria-label="取消"]').trigger("click");
  expect(wrapper.vm.hasPending).toBe(false);
  read.resolve(Uint8Array.of(67, 67, 79).buffer);
  await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  await upload(wrapper);
  expect(wrapper.text()).toContain("选择化合物");
});

test("cancelling a parser request aborts its signal and ignores its late response", async () => {
  const task = deferred();
  API.post.mockReturnValue(task.promise);
  const wrapper = make();
  await upload(wrapper);
  const signal = API.post.mock.calls[0][3].signal;
  await wrapper.get('[aria-label="取消"]').trigger("click");
  expect(signal.aborted).toBe(true);
  task.resolve({ format: "sdf", records: [record] });
  await flushPromises();
  expect(wrapper.text()).not.toContain("选择化合物");
  expect(wrapper.emitted("import")).toBeUndefined();
});

test("unreadable drawings never fall back to the older SMILES field", async () => {
  const wrapper = make({ smiles: "CCO", readStructure: async () => { throw new Error("reader unavailable"); } });
  await button(wrapper, "MOL 结构").trigger("click");
  await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toContain("化学结构导出失败");
  expect(wrapper.vm.hasPending).toBe(false);
});

test("source changes dismiss replacement confirmation without applying its staged structure", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make({ smiles: "CCN" });
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  await flushPromises();
  await wrapper.setProps({ smiles: "CCC" });
  expect(wrapper.find(".replacement-preview").exists()).toBe(false);
  expect(wrapper.emitted("import")).toBeUndefined();
});

test("accepted source names remain raw in the export payload and filename", async () => {
  const named = { ...record, name: "取消-样品 β" };
  API.post.mockResolvedValueOnce({ format: "sdf", records: [named] });
  const wrapper = make();
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  await flushPromises();
  await wrapper.setProps({ smiles: named.smiles });
  API.post.mockResolvedValueOnce({ valid: true, smiles: "CCO", atoms: 3 })
    .mockResolvedValueOnce({ format: "smi", content: "CCO\t取消-样品 β\n" });
  await button(wrapper, "SMILES 文件").trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[2][1]).toEqual({ smiles: "CCO", name: named.name, format: "smi" });
  expect(downloadChemicalFile).toHaveBeenCalledWith(expect.any(Object), named.name, "smi");
});

test("cancel returns focus to the import command", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const wrapper = make();
  const origin = wrapper.get('[aria-label="导入结构文件"]');
  origin.element.focus();
  await origin.trigger("click");
  await upload(wrapper);
  button(wrapper, "取消").element.focus();
  await button(wrapper, "取消").trigger("click");
  await nextTick();
  expect(document.activeElement).toBe(origin.element);
});

test("unmount cancels a deferred export and does not publish an error or download", async () => {
  const task = deferred();
  API.post.mockReturnValue(task.promise);
  const wrapper = make({ smiles: "CCO" });
  await button(wrapper, "MOL 结构").trigger("click");
  await flushPromises();
  const signal = API.post.mock.calls[0][3].signal;
  wrapper.unmount();
  expect(signal.aborted).toBe(true);
  task.resolve({ format: "mol", content: "late output" });
  await flushPromises();
  expect(downloadChemicalFile).not.toHaveBeenCalled();
  wrappers = wrappers.filter((value) => value !== wrapper);
});

test("empty reader-backed drafts can import without treating the native empty-read sentinel as failure", async () => {
  API.post.mockResolvedValue({ format: "sdf", records: [record] });
  const read = jest.fn().mockResolvedValue(null);
  const wrapper = make({ readStructure: read });
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  expect(wrapper.emitted("import")).toBeUndefined();
  expect(wrapper.vm.hasPending).toBe(true);
  await button(wrapper, "确定").trigger("click");
  expect(wrapper.emitted("import")).toEqual([[record]]);
  expect(read).not.toHaveBeenCalled();
});

test("reader serialization cannot lose an accepted raw name when RDKit confirms the same identity", async () => {
  const named = { ...record, name: "取消-样品 β" };
  API.post.mockResolvedValueOnce({ format: "sdf", records: [named] });
  const read = jest.fn();
  const wrapper = make({ readStructure: read });
  await upload(wrapper);
  await button(wrapper, "应用结构").trigger("click");
  await button(wrapper, "确定").trigger("click");
  await wrapper.setProps({ smiles: "CCO" });
  read.mockImplementation(async () => { await wrapper.setProps({ smiles: "OCC" }); return "OCC"; });
  API.post.mockResolvedValueOnce({ valid: true, smiles: "CCO", atoms: 3 })
    .mockResolvedValueOnce({ format: "mol", content: "API content" });
  await button(wrapper, "MOL 结构").trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[2][1]).toEqual({ smiles: "CCO", name: named.name, format: "mol" });
  expect(downloadChemicalFile).toHaveBeenCalledWith(expect.any(Object), named.name, "mol");
});
