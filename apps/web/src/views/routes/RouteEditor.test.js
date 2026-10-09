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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import { initializeLocale, setLocale } from "@/i18n";
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));

test("the document title does not suppress the shared keyboard-focus outline", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "RouteEditor.vue"), "utf8"));
  const stylesheet = document.createElement("style");
  stylesheet.textContent = descriptor.styles[0].content;
  document.head.append(stylesheet);
  try {
    const rule = [...stylesheet.sheet.cssRules].find(item => item.selectorText === ".document-title-input");
    expect(rule.style.getPropertyValue("outline")).not.toBe("none");
  } finally { stylesheet.remove(); }
});

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
  props: ["graph", "editable", "stepNumbers"],
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

test("a loaded document has one named page heading while retaining its editable title and full canvas", async () => {
  const { wrapper } = await setup();
  const name = wrapper.get('[aria-label="路线名称"]').element.value;
  expect(wrapper.findAll("h1")).toHaveLength(1);
  expect(wrapper.get("h1").text()).toBe(name);
  expect(wrapper.get(".editor-graph").exists()).toBe(true);
});

test("a failed saved-document read offers a retry rather than a new-route creation form", async () => {
  API.get.mockRejectedValueOnce(new Error("read failed"));
  const { wrapper } = await setup();
  expect(wrapper.find(".editor-create-form").exists()).toBe(false);
  expect(wrapper.get(".editor-unavailable h1").text()).toBe("路线文档加载失败。");
  await wrapper.get('[data-cy="document-load-retry"]').trigger("click");
  await flushPromises();
  expect(wrapper.find(".editor-unavailable").exists()).toBe(false);
  expect(wrapper.get(".editor-graph").exists()).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
});
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

test("new-route title uses the creation locale but language changes never edit the draft or its dirty baseline", async () => {
  initializeLocale(null);
  const { wrapper, route } = await setup("draft", "");
  const titleInput = wrapper.get(".editor-create-form input");
  expect(titleInput.element.value).toBe("Untitled route");
  expect(wrapper.vm.hasUnsavedChanges).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toBe("New route");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get(".editor-create-form input").element).toBe(titleInput.element);
  expect(titleInput.element.value).toBe("Untitled route");
  expect(wrapper.vm.hasUnsavedChanges).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toBe("新路线");
  await titleInput.setValue("未命名路线");
  expect(wrapper.vm.hasUnsavedChanges).toBe(true);
  setLocale("en", { persist: false });
  await flushPromises();
  expect(titleInput.element.value).toBe("未命名路线");
  expect(wrapper.vm.hasUnsavedChanges).toBe(true);
  expect(wrapper.get('[role="status"]').text()).toBe("Unsaved");
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
  route.params.id = documentId;
  await flushPromises();
  route.params.id = undefined;
  await flushPromises();
  expect(wrapper.get(".editor-create-form input").element.value).toBe("Untitled route");
  expect(wrapper.vm.hasUnsavedChanges).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("an empty new-route title sends its fixed draft default, while a typed Chinese title remains literal", async () => {
  initializeLocale(null);
  const { wrapper } = await setup("draft", "");
  const smiles = "[13CH3][C@H](F)C(=O)[O-].[Na+]";
  API.post.mockImplementation(async (path, body) => path === "/api/v1/structure/validate"
    ? { smiles: body.smiles } : { id: documentId, title: body.title, graph: body.graph, revision: 1, state: "draft" });
  await wrapper.get(".editor-create-form input").setValue("");
  await wrapper.get(".editor-create-form textarea").setValue(smiles);
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(API.post.mock.calls[0]).toEqual(["/api/v1/structure/validate", { smiles }]);
  expect(API.post.mock.calls[1][1].title).toBe("Untitled route");
  await wrapper.get('[aria-label="路线名称"]').setValue("未命名路线");
  setLocale("en", { persist: false });
  await flushPromises();
  expect(wrapper.get('[aria-label="Route name"]').element.value).toBe("未命名路线");
  expect(wrapper.get("h1").text()).toBe("未命名路线");
  expect(wrapper.vm.hasUnsavedChanges).toBe(true);
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

async function idleInspector(wrapper) {
  wrapper.getComponent({ name: "RouteGraph" }).vm.$emit("select", "target");
  await flushPromises();
  const inspector = wrapper.getComponent({ name: "RouteInspector" });
  await inspector.get('textarea[maxlength="4096"]').setValue("idle draft");
  return inspector;
}

test("idle unapplied edits protect navigation, unload and cancelled file loading without any write", async () => {
  const { wrapper } = await setup();
  const inspector = await idleInspector(wrapper);
  expect(wrapper.get('[role="status"]').text()).toBe("未应用修改");
  window.confirm.mockReturnValue(false);
  expect(onBeforeRouteLeave.mock.calls[0][0]({ path: "/documents" })).toBe(false);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const file = await selectFile(wrapper);
  expect(file.text).not.toHaveBeenCalled();
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
});

test.each(["close", "select", "undo", "save", "copy", "remove", "arrange"])(
  "cancelled %s retains an idle draft and the applied graph",
  async (action) => {
    const { wrapper } = await setup();
    const canvas = wrapper.getComponent({ name: "RouteGraph" });
    const edited = { ...graph, nodes: [...graph.nodes, { ...graph.nodes[0], id: "material", smiles: "N" }] };
    canvas.vm.$emit("update:graph", edited);
    const inspector = await idleInspector(wrapper);
    window.confirm.mockReturnValue(false);
    if (action === "close") inspector.vm.$emit("close");
    if (action === "select") canvas.vm.$emit("select", "material");
    if (action === "undo") wrapper.vm.runEditAction(wrapper.vm.editActions.find(item => item.label === "撤销"));
    if (action === "save" || action === "copy") await wrapper.vm.saveDocument(action === "copy");
    if (action === "remove") inspector.vm.$emit("remove");
    if (action === "arrange") wrapper.vm.runEditAction(wrapper.vm.editActions.find(item => item.label === "自动布局"));
    await flushPromises();
    expect(window.confirm).toHaveBeenCalled();
    expect(canvas.props("graph")).toEqual(edited);
    expect(wrapper.getComponent({ name: "RouteInspector" }).props("node").id).toBe("target");
    expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
    expect(API.put).not.toHaveBeenCalled();
    expect(API.post).not.toHaveBeenCalled();
  },
);

test("confirmed save-copy discards only the staged fields and never serializes unconfirmed structures", async () => {
  const { wrapper } = await setup();
  const inspector = await idleInspector(wrapper);
  await inspector.get('textarea[aria-label="目标化合物结构"]').setValue("unconfirmed");
  API.post.mockImplementation(async (_, body) => ({ id: importedId, ...body, revision: 0, state: "draft" }));
  await wrapper.vm.saveDocument(true);
  await flushPromises();
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/api/v1/route-documents", { title: "Document", graph });
  expect(API.put).not.toHaveBeenCalled();
});

const conflictMessage = "文档已被其他页面修改，请重新载入或另存副本。";
test("only a deterministic revision conflict offers confirmed reload and cancellation preserves both draft layers", async () => {
  const { wrapper } = await setup();
  await wrapper.get('[aria-label="路线名称"]').setValue("local title");
  API.put.mockRejectedValue(new Error(JSON.stringify({ detail: conflictMessage })));
  await wrapper.vm.saveDocument(false);
  await flushPromises();
  const reload = wrapper.get('[data-cy="document-conflict-reload"]');
  const inspector = await idleInspector(wrapper);
  const reads = API.get.mock.calls.length;
  window.confirm.mockReturnValue(false);
  await reload.trigger("click");
  expect(API.get).toHaveBeenCalledTimes(reads);
  expect(wrapper.get('[aria-label="路线名称"]').element.value).toBe("local title");
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  window.confirm.mockReturnValue(true);
  API.get.mockResolvedValue({ id: documentId, title: "server title", graph, revision: 2, state: "draft" });
  await reload.trigger("click");
  await flushPromises();
  expect(API.get).toHaveBeenCalledTimes(reads + 1);
  expect(wrapper.get('[aria-label="路线名称"]').element.value).toBe("server title");
  expect(wrapper.get('[role="status"]').text()).toBe("已保存");
  expect(wrapper.find('[data-cy="document-conflict-reload"]').exists()).toBe(false);
  await wrapper.get('[aria-label="路线名称"]').setValue("another title");
  API.put.mockRejectedValue(new Error(JSON.stringify({ detail: "other 409" })));
  await wrapper.vm.saveDocument(false);
  await flushPromises();
  expect(wrapper.find('[data-cy="document-conflict-reload"]').exists()).toBe(false);
});

test("applied graph step numbers track undo and never rewrite original reaction labels", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  const value = { ...graph, nodes: [graph.nodes[0],
    { id: "later", type: "reaction", smiles: "", label: "反应 1", note: "raw", position: { x: 200, y: 20 } },
    { ...graph.nodes[0], id: "middle", smiles: "CO" },
    { id: "earlier", type: "reaction", smiles: "", label: "反应 2", note: "", position: { x: 10, y: 10 } },
    { ...graph.nodes[0], id: "start", smiles: "O" },
  ], edges: [{ id: "a", source: "start", target: "earlier", input_occurrences: 2 },
    { id: "b", source: "earlier", target: "middle" }, { id: "c", source: "middle", target: "later" },
    { id: "d", source: "later", target: "target" }] };
  const before = JSON.stringify(value);
  canvas.vm.$emit("update:graph", value); canvas.vm.$emit("select", "earlier");
  await flushPromises();
  expect(canvas.props("stepNumbers")).toEqual({ earlier: 1, later: 2 });
  expect(wrapper.getComponent({ name: "RouteInspector" }).props("displayStepNumber")).toBe(1);
  expect(wrapper.getComponent({ name: "RouteInspector" }).get("input").element.value).toBe("反应 2");
  await wrapper.get('button[aria-label="撤销"]').trigger("click");
  expect(canvas.props("stepNumbers")).toEqual({});
  expect(JSON.stringify(value)).toBe(before);
});

test("idle draft discard makes only confirmed applied edits undoable and redoable", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" });
  const edited = { ...graph, nodes: [...graph.nodes, { ...graph.nodes[0], id: "material", smiles: "N" }] };
  canvas.vm.$emit("update:graph", edited);
  await flushPromises();
  await wrapper.get('button[aria-label="撤销"]').trigger("click");
  expect(canvas.props("graph")).toEqual(graph);
  const inspector = await idleInspector(wrapper);
  expect(inspector.vm.draftDirty).toBe(true);
  expect(wrapper.vm.draftGuard.dirty.value).toBe(true);
  window.confirm.mockReturnValue(false);
  await wrapper.get('button[aria-label="重做"]').trigger("click");
  expect(canvas.props("graph")).toEqual(graph);
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  window.confirm.mockReturnValue(true);
  await wrapper.get('button[aria-label="重做"]').trigger("click");
  expect(canvas.props("graph")).toEqual(edited);
  expect(canvas.props("graph").nodes.every(node => node.note === "")).toBe(true);
  expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
});

test("position-only graph replacement retains unapplied fields without saving them", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" }), inspector = await idleInspector(wrapper);
  const moved = { ...graph, nodes: graph.nodes.map(node => ({ ...node, position: { x: 250, y: 120 } })) };
  canvas.vm.$emit("update:graph", moved); await flushPromises();
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  expect(wrapper.vm.draftGuard.dirty.value).toBe(true);
  expect(canvas.props("graph").nodes[0].note).toBe("");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(API.put).not.toHaveBeenCalled();
});

test("cancelled graph content replacement retains the graph and inspected draft", async () => {
  const { wrapper } = await setup();
  const canvas = wrapper.getComponent({ name: "RouteGraph" }), inspector = await idleInspector(wrapper);
  window.confirm.mockReturnValue(false);
  canvas.vm.$emit("update:graph", { ...graph, nodes: graph.nodes.map(node => ({ ...node, smiles: "N" })) }); await flushPromises();
  expect(canvas.props("graph")).toEqual(graph);
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  expect(window.confirm).toHaveBeenCalledTimes(1);
});

test("accepted file load does not discard idle fields before navigation and needs only one confirmation", async () => {
  const { wrapper, router } = await setup();
  const inspector = await idleInspector(wrapper);
  API.post.mockResolvedValue({ id: importedId });
  router.replace.mockImplementation(async path => {
    expect(onBeforeRouteUpdate.mock.calls[0][0]({ path })).toBe(true);
  });
  await selectFile(wrapper);
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith("/editor/" + importedId);
  expect(inspector.get('textarea[maxlength="4096"]').element.value).toBe("idle draft");
  expect(API.post.mock.calls[0][1].graph).toEqual(graph);
});

test("Apply clears the staged signal only when the validated update becomes applied graph data", async () => {
  const { wrapper } = await setup();
  const inspector = await idleInspector(wrapper);
  API.post.mockResolvedValue({ smiles: "CCO" });
  await buttonWithText(inspector, "应用修改").trigger("click");
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteGraph" }).props("graph").nodes[0].note).toBe("idle draft");
  expect(wrapper.get('[role="status"]').text()).toBe("未保存");
  expect(inspector.vm.draftDirty).toBe(false);
  window.confirm.mockReturnValue(false);
  inspector.vm.$emit("close");
  await flushPromises();
  expect(window.confirm).not.toHaveBeenCalled();
  expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
});

test("old inspector signals cannot mark a loaded document with the same node ID dirty", async () => {
  const { wrapper, route } = await setup();
  const previous = await idleInspector(wrapper);
  API.get.mockResolvedValue({ id: importedId, title: "new document", graph, revision: 1, state: "draft" });
  route.params.id = importedId;
  await flushPromises();
  wrapper.getComponent({ name: "RouteGraph" }).vm.$emit("select", "target");
  await flushPromises();
  wrapper.getComponent({ name: "RouteInspector" }).vm.$emit("draft-change", {
    contextId: documentId, nodeId: "target", dirty: true, revision: 999,
  });
  await flushPromises();
  expect(previous.exists()).toBe(false);
  expect(wrapper.get('[role="status"]').text()).toBe("已保存");
  expect(wrapper.vm.hasUnsavedChanges).toBe(false);
});
