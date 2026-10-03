import { mount, flushPromises } from "@vue/test-utils";
import { TextDecoder } from "util";
import { nextTick } from "vue";
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
  VRadioGroup: slot,
  VRadio: true,
  VPagination: true,
  SmilesImage: true,
};
let wrappers = [];
function make(props = {}) {
  const wrapper = mount(MoleculeFileControls, { props, global: { stubs } });
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
async function upload(wrapper) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [
      {
        name: "compound.sdf",
        size: 3,
        arrayBuffer: async () => Uint8Array.of(67, 67, 79).buffer,
      },
    ],
  });
  await input.trigger("change");
  await flushPromises();
}
beforeEach(() => {
  global.TextDecoder = TextDecoder;
  jest.clearAllMocks();
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
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
  API.post.mockResolvedValue({ format: "mol", content: "chemical file" });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "MOL 结构")
    .trigger("click");
  await flushPromises();
  expect(API.post).toHaveBeenCalledWith("/api/v1/structure/export", {
    smiles: "CCN",
    format: "mol",
    name: "",
  });
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
