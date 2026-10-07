import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
} from "vue-router";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import RouteEditor from "./RouteEditor.vue";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { reactive } from "vue";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));

jest.mock("vue-router", () => ({
  useRoute: jest.fn(),
  useRouter: jest.fn(),
  onBeforeRouteLeave: jest.fn(),
  onBeforeRouteUpdate: jest.fn(),
}));
jest.mock("@/common/api", () => ({
  API: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
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
  template: "<div />",
}));
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = (value) => deserialize(serialize(value));
jest.mock("@/components/routes/RouteGraph.vue", () => ({
  name: "RouteGraph",
  props: ["graph", "editable"],
  emits: ["update:graph", "select"],
  template: '<div class="editor-graph" />',
}));
jest.mock("@/components/routes/RouteNodeContext.vue", () => ({
  name: "RouteNodeContext",
  template: '<div class="node-context" />',
}));
jest.mock("@/components/routes/ExpandMolecule.vue", () => ({
  name: "ExpandMolecule",
  template: "<div />",
}));
const documentId = "a".repeat(32),
  importedId = "b".repeat(32),
  jobId = "c".repeat(32);
const graph = {
  target_id: "target",
  nodes: [
    {
      id: "target",
      type: "molecule",
      smiles: "CCO",
      label: "",
      note: "",
      position: { x: 5, y: 5 },
    },
  ],
  edges: [],
};
const stubs = {
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VBtn: {
    props: ["disabled"],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  VList: { template: "<div><slot /></div>" },
  VListItem: true,
  VIcon: true,
  VDialog: {
    props: ["modelValue"],
    template: '<div v-if="modelValue" class="dialog"><slot /></div>',
  },
  VProgressCircular: true,
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: true,
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VSelect: {
    props: ["modelValue", "items", "disabled"],
    template:
      '<select :value="modelValue" :disabled="disabled"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
  },
  VSpacer: true,
  RouterLink: {
    name: "RouterLink",
    props: ["to"],
    template: '<a class="origin-link"><slot /></a>',
  },
};
const wrappers = [];
const buttonWithText = (wrapper, text) =>
  wrapper.findAll("button").find((button) => button.text() === text);
async function setup(state = "source_copy", identifier = documentId) {
  const router = { replace: jest.fn().mockResolvedValue(undefined) };
  const route = reactive({ params: { id: identifier } });
  useRoute.mockReturnValue(route);
  useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ can: () => false });
  API.get.mockResolvedValue({
    id: documentId,
    title: "Document",
    graph,
    revision: 1,
    state,
    source:
      state === "source_copy"
        ? { job_id: jobId, route_id: "askcos_mcts:record", route_index: 0 }
        : {},
  });
  const wrapper = mount(RouteEditor, { global: { stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, route };
}
async function selectFile(wrapper, value = {}) {
  const file = {
    size: 100,
    text: jest.fn().mockResolvedValue(
      JSON.stringify({
        format: "x-synth-route",
        version: 1,
        title: "Imported",
        graph,
        ...value,
      }),
    ),
  };
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
  await flushPromises();
  return file;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  window.confirm.mockRestore();
});

test("a pending real inspector Apply locks conflicting edits and save until the new structure is applied", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  const edited = {
    ...graph,
    nodes: [...graph.nodes, { ...graph.nodes[0], id: "material", smiles: "N" }],
  };
  canvas.vm.$emit("update:graph", edited);
  canvas.vm.$emit("select", "material");
  await flushPromises();
  const inspector = wrapper.getComponent({ name: "RouteInspector" });
  const chemistry = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  await inspector
    .get('textarea[aria-label="中间体或原料结构"]')
    .setValue(chemistry);
  let resolve;
  API.post.mockReturnValue(
    new Promise((yes) => { resolve = yes; }),
  );
  const saveButton = buttonWithText(wrapper, "保存");
  const applyButton = buttonWithText(inspector, "应用修改");
  expect(saveButton.element.disabled).toBe(false);
  await applyButton.trigger("click");
  expect(inspector.props("editable")).toBe(true);
  expect(canvas.props("editable")).toBe(false);
  expect(saveButton.element.disabled).toBe(true);
  expect(wrapper.get('input[aria-label="路线名称"]').element.disabled).toBe(
    true,
  );
  for (const label of [
    "撤销", "重做", "删除所选结构或反应步骤", "自动布局", "打开路线文档",
  ])
    expect(
      wrapper.get(`button[aria-label="${label}"]`).element.disabled,
    ).toBe(true);
  await saveButton.trigger("click");
  await wrapper.vm.saveDocument(false);
  await wrapper.vm.saveDocument(true);
  const imported = await selectFile(wrapper);
  expect(imported.text).not.toHaveBeenCalled();
  canvas.vm.$emit("update:graph", graph);
  canvas.vm.$emit("select", "target");
  inspector.vm.$emit("remove");
  wrapper.vm.runEditAction(
    wrapper.vm.editActions.find((action) => action.label === "撤销"),
  );
  await flushPromises();
  expect(inspector.props("node").id).toBe("material");
  expect(canvas.props("graph")).toEqual(edited);
  expect(API.put).not.toHaveBeenCalled();
  expect(API.post).toHaveBeenCalledTimes(1);
  resolve({ smiles: chemistry });
  await flushPromises();
  const applied = canvas.props("graph");
  expect(applied.nodes.find((node) => node.id === "material").smiles).toBe(
    chemistry,
  );
  expect(inspector.emitted("pending").map(([value]) => value)).toEqual([
    true, false,
  ]);
  expect(saveButton.element.disabled).toBe(false);
  expect(canvas.props("editable")).toBe(true);
  expect(wrapper.text()).toContain("草稿");
  API.put.mockImplementation(async (_, body) => ({
    id: documentId,
    ...body,
    revision: 2,
    state: "draft",
  }));
  await saveButton.trigger("click");
  await flushPromises();
  expect(API.put).toHaveBeenCalledWith(`/api/v1/route-documents/${documentId}`, {
    title: "Document",
    graph: applied,
    revision: 1,
  });
  expect(wrapper.text()).toContain("已保存");
});

test.each(["failure", "invalid"])(
  "a real inspector %s unlocks the document without losing the unapplied draft",
  async (outcome) => {
    const { wrapper } = await setup();
    const canvas = wrapper.getComponent({ name: "RouteGraph" });
    await wrapper
      .get('input[aria-label="路线名称"]')
      .setValue("Unsaved title");
    canvas.vm.$emit("select", "target");
    await flushPromises();
    const inspector = wrapper.getComponent({ name: "RouteInspector" });
    await inspector
      .get('textarea[aria-label="目标化合物结构"]')
      .setValue("N");
    let resolve, reject;
    API.post.mockReturnValue(
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
    );
    await buttonWithText(inspector, "应用修改").trigger("click");
    expect(canvas.props("editable")).toBe(false);
    if (outcome === "failure") reject(new Error("validation failed"));
    else resolve({ smiles: "" });
    await flushPromises();
    expect(canvas.props("editable")).toBe(true);
    expect(canvas.props("graph")).toEqual(graph);
    expect(
      inspector.get('textarea[aria-label="目标化合物结构"]').element.value,
    ).toBe("N");
    expect(inspector.get('[role="alert"]').text()).toBeTruthy();
    expect(wrapper.get('input[aria-label="路线名称"]').element.value).toBe(
      "Unsaved title",
    );
    expect(wrapper.text()).toContain("未保存");
    expect(buttonWithText(wrapper, "保存").element.disabled).toBe(false);
    expect(API.put).not.toHaveBeenCalled();
  },
);

test("pending Apply protects navigation and a confirmed document switch releases its lock without accepting late chemistry", async () => {
  const { wrapper, route } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  canvas.vm.$emit("select", "target");
  await flushPromises();
  let resolve;
  API.post.mockReturnValue(
    new Promise((yes) => { resolve = yes; }),
  );
  const inspector = wrapper.getComponent({ name: "RouteInspector" });
  await buttonWithText(inspector, "应用修改").trigger("click");
  window.confirm.mockReturnValue(false);
  expect(onBeforeRouteLeave.mock.calls[0][0]({ path: "/documents" })).toBe(
    false,
  );
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  window.confirm.mockReturnValue(true);
  expect(
    onBeforeRouteUpdate.mock.calls[0][0]({ path: "/editor/" + importedId }),
  ).toBe(true);
  API.get.mockResolvedValue({
    id: importedId,
    title: "Other document",
    graph,
    revision: 1,
    state: "draft",
  });
  route.params.id = importedId;
  await flushPromises();
  const nextCanvas = wrapper.getComponent({ name: "RouteGraph" });
  expect(nextCanvas.props("editable")).toBe(true);
  resolve({ smiles: "N" });
  await flushPromises();
  expect(nextCanvas.props("graph")).toEqual(graph);
  expect(wrapper.get('input[aria-label="路线名称"]').element.value).toBe(
    "Other document",
  );
  expect(wrapper.text()).toContain("已保存");
  expect(API.put).not.toHaveBeenCalled();
});
test("saved source copies and saved drafts have independent scientific badges", async () => {
  const copy = await setup();
  expect(copy.wrapper.text()).toContain("已保存");
  expect(copy.wrapper.text()).toContain("计算结果副本");
  expect(copy.wrapper.getComponent({ name: "RouterLink" }).props("to")).toEqual(
    {
      path: "/results/" + jobId,
      query: { route_id: "askcos_mcts:record", route_index: "0" },
    },
  );
  const draft = await setup("draft");
  expect(draft.wrapper.text()).toContain("已保存");
  expect(draft.wrapper.text()).toContain("草稿");
  expect(draft.wrapper.find(".origin-link").exists()).toBe(false);
});
test("declining open-file replacement leaves the existing title dirty and makes no POST", async () => {
  const { wrapper, router } = await setup();
  await wrapper.get('input[aria-label="路线名称"]').setValue("Unsaved title");
  window.confirm.mockReturnValue(false);
  const file = await selectFile(wrapper);
  expect(file.text).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(wrapper.get('input[aria-label="路线名称"]').element.value).toBe(
    "Unsaved title",
  );
  expect(wrapper.text()).toContain("未保存");
  expect(onBeforeRouteLeave.mock.calls[0][0]({ path: "/results" })).toBe(false);
});
test("accepted import still strips client source-copy claims and does not clear the current dirty graph", async () => {
  const { wrapper, router } = await setup();
  await wrapper.get('input[aria-label="路线名称"]').setValue("Unsaved title");
  API.post.mockResolvedValue({ id: importedId });
  router.replace.mockImplementation(async (path) => {
    expect(wrapper.text()).toContain("正在打开");
    expect(onBeforeRouteUpdate.mock.calls[0][0]({ path })).toBe(true);
  });
  await selectFile(wrapper, {
    state: "source_copy",
    source_closed: true,
    source: { job_id: jobId },
  });
  expect(API.post).toHaveBeenCalledWith("/api/v1/route-documents", {
    title: "Imported",
    graph,
  });
  expect(router.replace).toHaveBeenCalledWith("/editor/" + importedId);
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("未保存");
});
test("inspector context receives the live edited graph rather than the persisted source snapshot", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  const edited = {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, smiles: "O" })),
  };
  canvas.vm.$emit("update:graph", edited);
  canvas.vm.$emit("select", "target");
  await flushPromises();
  expect(
    wrapper.getComponent({ name: "RouteInspector" }).props("graph"),
  ).toEqual(edited);
  expect(wrapper.text()).toContain("草稿");
  expect(wrapper.text()).toContain("未保存");
});
test("new-document input is protected before any document or model request exists", async () => {
  const { wrapper, router } = await setup("draft", null);
  const guard = onBeforeRouteLeave.mock.calls[0][0];
  expect(guard({ path: "/results" })).toBe(true);
  await wrapper.get(".editor-create-form textarea").setValue("CCO");
  window.confirm.mockReturnValue(false);
  expect(guard({ path: "/results" })).toBe(false);
  expect(wrapper.get(".editor-create-form textarea").element.value).toBe("CCO");
  expect(API.get).not.toHaveBeenCalled();
  expect(API.post).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

test("new routes use the shared target structure input and keep route-document file actions distinct", async () => {
  const { wrapper, router } = await setup("draft", null);
  const input = wrapper.getComponent({ name: "StructureInput" });
  expect(input.props("label")).toBe("目标化合物结构");
  expect(wrapper.text()).toContain("打开路线文档");
  expect(wrapper.get('input[type="file"]').attributes("accept")).toBe(
    ".json,application/json",
  );
  await wrapper.get('textarea[aria-label="目标化合物结构"]').setValue("CCO");
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    id: documentId,
    title: "未命名路线",
    graph,
    revision: 1,
    state: "draft",
  });
  await wrapper.get(".editor-create-form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls[0]).toEqual([
    "/api/v1/structure/validate",
    { smiles: "CCO" },
  ]);
  expect(API.post.mock.calls[1][0]).toBe("/api/v1/route-documents");
  expect(router.replace).toHaveBeenCalledWith("/editor/" + documentId);
});

test("manual reaction insertion is a connected, undoable draft edit rather than an isolated reaction", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  canvas.vm.$emit("select", "target");
  await flushPromises();
  await wrapper.get('button[aria-label="手动补充反应步骤"]').trigger("click");
  await wrapper.get('textarea[aria-label="反应物 1"]').setValue("CC=O");
  await wrapper.get('textarea[aria-label="反应物 2"]').setValue("[H][H]");
  API.post.mockImplementation(async (_, { smiles }) => ({ smiles }));
  await wrapper.get(".manual-reaction-form").trigger("submit");
  await flushPromises();
  const edited = canvas.props("graph");
  expect(edited.nodes).toHaveLength(4);
  expect(edited.edges).toHaveLength(3);
  expect(wrapper.text()).toContain("草稿");
  expect(wrapper.text()).toContain("未保存");
  expect(API.post).toHaveBeenCalledTimes(2);
  await wrapper.get('button[aria-label="撤销"]').trigger("click");
  expect(canvas.props("graph").nodes).toHaveLength(1);
  await wrapper.get('button[aria-label="重做"]').trigger("click");
  expect(canvas.props("graph").nodes).toHaveLength(4);
});

test("cancelled manual step entries do not change the route or start validation", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  await wrapper.get('button[aria-label="手动补充反应步骤"]').trigger("click");
  await wrapper.get('textarea[aria-label="反应物 1"]').setValue("CC=O");
  await wrapper.get('button[aria-label="关闭手动反应步骤"]').trigger("click");
  expect(canvas.props("graph")).toEqual(graph);
  expect(wrapper.text()).toContain("已保存");
  expect(API.post).not.toHaveBeenCalled();
});

test("manual validation cannot write a reaction into a new document with the same molecule ID", async () => {
  const { wrapper, route } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  canvas.vm.$emit("select", "target");
  await flushPromises();
  await wrapper.get('button[aria-label="手动补充反应步骤"]').trigger("click");
  await wrapper.get('textarea[aria-label="反应物 1"]').setValue("CC=O");
  await wrapper.get('textarea[aria-label="反应物 2"]').setValue("[H][H]");
  let resolve;
  API.post.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  await wrapper.get(".manual-reaction-form").trigger("submit");
  API.get.mockResolvedValue({
    id: importedId,
    title: "New document",
    graph,
    revision: 1,
    state: "draft",
  });
  route.params.id = importedId;
  await flushPromises();
  resolve({ smiles: "O" });
  await flushPromises();
  expect(canvas.props("graph")).toEqual(graph);
  expect(wrapper.text()).toContain("已保存");
  expect(wrapper.find(".manual-reaction-form").exists()).toBe(false);
});

test("closing the add-material dialog invalidates its pending structure check", async () => {
  const { wrapper } = await setup();
  await wrapper.get('button[aria-label="添加中间体或原料"]').trigger("click");
  await wrapper.get('textarea[aria-label="中间体或原料结构"]').setValue("O");
  let resolve;
  API.post.mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "添加")
    .trigger("click");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "取消")
    .trigger("click");
  resolve({ smiles: "O" });
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteGraph" }).props("graph")).toEqual(
    graph,
  );
  expect(wrapper.text()).toContain("已保存");
});
