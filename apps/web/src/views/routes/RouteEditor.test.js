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
jest.mock("@/components/routes/RouteGraph.vue", () => ({
  name: "RouteGraph",
  props: ["graph", "editable"],
  emits: ["update:graph", "select"],
  template: '<div class="editor-graph" />',
}));
jest.mock("@/components/routes/RouteInspector.vue", () => ({
  name: "RouteInspector",
  props: ["node", "graph"],
  template: '<div class="inspector" />',
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
  VDialog: true,
  VProgressCircular: true,
  VCard: true,
  VCardTitle: true,
  VCardText: true,
  VCardActions: true,
  VSpacer: true,
  RouterLink: {
    name: "RouterLink",
    props: ["to"],
    template: '<a class="origin-link"><slot /></a>',
  },
};
const wrappers = [];
async function setup(state = "source_copy", identifier = documentId) {
  const router = { replace: jest.fn().mockResolvedValue(undefined) };
  useRoute.mockReturnValue({ params: { id: identifier } });
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
  return { wrapper, router };
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
