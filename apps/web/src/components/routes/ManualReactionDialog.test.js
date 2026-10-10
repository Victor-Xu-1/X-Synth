import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import ManualReactionDialog from "./ManualReactionDialog.vue";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  name: "StructureInput",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue"],
  template:
    '<label>{{ label }}<textarea :aria-label="label" :disabled="disabled" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles"],
  template: '<div class="structure-image" />',
}));
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = (value) => deserialize(serialize(value));

const graph = () => ({
  target_id: "target",
  nodes: [
    {
      id: "target",
      type: "molecule",
      smiles: "CC(=O)N",
      position: { x: 20, y: 20 },
    },
  ],
  edges: [],
});
const wrappers = [];
const stubs = {
  VDefaultsProvider: { template: "<slot />" },
  VDialog: {
    props: ["modelValue"],
    template: '<div v-if="modelValue"><slot /></div>',
  },
  VCard: { template: "<div><slot /></div>" },
  VBtn: {
    props: ["disabled", "type", "loading"],
    template:
      '<button :type="type || \'button\'" :disabled="disabled"><slot /></button>',
  },
  VSelect: {
    props: ["modelValue", "items", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
};
function setup(props = {}) {
  const wrapper = mount(ManualReactionDialog, {
    props: {
      graph: graph(),
      documentId: "a".repeat(32),
      selectedId: "target",
      modelValue: true,
      "onUpdate:modelValue": (value) => wrapper.setProps({ modelValue: value }),
      ...props,
    },
    global: { stubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
async function fill(wrapper, values = ["CC(=O)O", "N"]) {
  for (const [index, value] of values.entries())
    await wrapper
      .get(`textarea[aria-label="反应物 ${index + 1}"]`)
      .setValue(value);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.clearAllMocks();
  API.post.mockImplementation(async (_, { smiles }) => ({ smiles }));
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("the selected eligible molecule is the default product and every reactant uses the shared structure input", async () => {
  const value = graph();
  value.nodes.push({
    id: "precursor",
    type: "molecule",
    smiles: "CCO",
    label: "中间体 A",
    position: { x: 0, y: 0 },
  });
  const wrapper = setup({ graph: value, selectedId: "precursor" });
  expect(wrapper.get("select").element.value).toBe("precursor");
  expect(wrapper.getComponent({ name: "SmilesImage" }).props("smiles")).toBe(
    "CCO",
  );
  expect(wrapper.findAllComponents({ name: "StructureInput" })).toHaveLength(2);
  expect(API.post).not.toHaveBeenCalled();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "添加反应物")
    .trigger("click");
  expect(wrapper.findAllComponents({ name: "StructureInput" })).toHaveLength(3);
  await wrapper.get('button[aria-label="移除反应物 3"]').trigger("click");
  expect(wrapper.findAllComponents({ name: "StructureInput" })).toHaveLength(2);
});

test("submit validates each explicit reactant and emits exactly one fully connected manual step", async () => {
  const original = graph();
  const wrapper = setup({ graph: original });
  await fill(wrapper, ["CC(=O)[O-].[Na+]", "N"]);
  await wrapper.get('input[maxlength="120"]').setValue("酰胺形成");
  await wrapper.get('textarea[maxlength="4096"]').setValue("手动记录");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post).toHaveBeenCalledTimes(2);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.emitted("add")).toHaveLength(1);
  const value = wrapper.emitted("add")[0][0];
  expect(value).toMatchObject({
    documentId: "a".repeat(32),
    selectedId: "target",
  });
  expect(value.graph.nodes).toHaveLength(4);
  expect(value.graph.edges).toHaveLength(3);
  expect(
    value.graph.nodes.find((node) => node.type === "reaction"),
  ).toMatchObject({ label: "酰胺形成", note: "手动记录" });
  expect(
    value.graph.nodes.some((node) => node.smiles === "CC(=O)[O-].[Na+]"),
  ).toBe(true);
  expect(original).toEqual(graph());
  expect(wrapper.props("modelValue")).toBe(false);
});

test.each(["cancel", "document", "selection", "disabled", "unmount"])(
  "late validation after %s cannot emit a graph",
  async (transition) => {
    const wrapper = setup();
    const pending = deferred();
    API.post.mockReturnValue(pending.promise);
    await fill(wrapper);
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");
    expect(API.post).toHaveBeenCalledTimes(2);
    expect(
      wrapper.get('textarea[aria-label="反应物 1"]').element.disabled,
    ).toBe(true);
    if (transition === "cancel")
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "取消")
        .trigger("click");
    if (transition === "document")
      await wrapper.setProps({ documentId: "b".repeat(32) });
    if (transition === "selection")
      await wrapper.setProps({ selectedId: "other" });
    if (transition === "disabled") await wrapper.setProps({ disabled: true });
    if (transition === "unmount") {
      wrapper.unmount();
      wrappers.splice(wrappers.indexOf(wrapper), 1);
    }
    pending.resolve({ smiles: "O" });
    await flushPromises();
    expect(wrapper.emitted("add")).toBeUndefined();
  },
);

test("a changed route snapshot blocks the entire late result without overwriting the draft", async () => {
  const wrapper = setup();
  const pending = deferred();
  API.post.mockReturnValue(pending.promise);
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  const value = graph();
  value.nodes[0].smiles = "CCO";
  await wrapper.setProps({ graph: value });
  pending.resolve({ smiles: "O" });
  await flushPromises();
  expect(wrapper.emitted("add")).toBeUndefined();
  expect(wrapper.get('[role="alert"]').text()).toContain("路线内容已变化");
  expect(wrapper.get('textarea[aria-label="反应物 1"]').element.value).toBe(
    "CC(=O)O",
  );
});

test("validation failure and cycle prevention leave the original route untouched", async () => {
  const original = graph();
  const wrapper = setup({ graph: original });
  await fill(wrapper, ["CC(=O)N", "O"]);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("循环");
  expect(wrapper.emitted("add")).toBeUndefined();
  API.post.mockRejectedValue(new Error("接口校验失败"));
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("反应物 1");
  expect(wrapper.emitted("add")).toBeUndefined();
  expect(original).toEqual(graph());
});

test("cancelled validation errors remain silent when the dialog is reopened", async () => {
  const wrapper = setup();
  const pending = deferred();
  API.post.mockReturnValue(pending.promise);
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  await wrapper.get('button[aria-label="关闭手动反应步骤"]').trigger("click");
  await wrapper.setProps({ modelValue: true });
  pending.reject(new Error("old failure"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.emitted("add")).toBeUndefined();
});

test("late chemical input updates cannot attach the previously validated reactants", async () => {
  const wrapper = setup();
  const pending = deferred();
  API.post.mockReturnValue(pending.promise);
  await fill(wrapper);
  await wrapper.get("form").trigger("submit");
  wrapper
    .findAllComponents({ name: "StructureInput" })[0]
    .vm.$emit("update:modelValue", "O");
  pending.resolve({ smiles: "N" });
  await flushPromises();
  expect(wrapper.emitted("add")).toBeUndefined();
  expect(wrapper.get('[role="alert"]').text()).toContain("结构输入已变化");
});
