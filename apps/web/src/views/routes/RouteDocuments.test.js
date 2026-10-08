import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, compileScript, compileStyle, compileTemplate } from "@vue/compiler-sfc";
import { API } from "@/common/api";
import RouteDocuments from "./RouteDocuments.vue";
import DocumentPreview from "@/components/routes/DocumentPreview.vue";
import { setLocale } from "@/i18n";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles"], template: '<div :data-smiles="smiles"><button aria-label="重试结构加载" /></div>',
}));
jest.mock("@/components/routes/DocumentPreview.vue", () => ({
  props: ["modelValue", "document"], template: "<div />",
}));

const stubs = {
  VDialog: { props: ["modelValue"], template: '<div v-if="modelValue" role="dialog"><slot /></div>' },
  VBtn: { props: ["disabled", "loading", "to"], template: '<button :disabled="disabled || loading" :data-to="to"><slot /></button>' },
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: { template: "<div><slot /></div>" },
  VListItem: {
    props: ["title", "disabled", "to"],
    template: '<button :disabled="disabled" :data-to="to">{{ title }}</button>',
  },
  VIcon: true,
  VProgressLinear: true,
  VTextField: {
    props: ["modelValue"], emits: ["update:modelValue"],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
};
const row = (id = "document-a", patch = {}) => ({
  id, title: "先导系列路线", target_smiles: "CCO", reaction_count: 2,
  modified: "2026-10-04T00:00:00Z", ...patch,
});
const savedDocument = (id = "document-a") => ({ ...row(id), revision: 0,
  graph: { target_id: "target", nodes: [{ id: "target", type: "molecule", smiles: "CCO", position: { x: 10, y: 10 } }], edges: [] } });
const wrappers = [];
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/documents", component: { render: () => null } },
    { path: "/editor/:id?", component: { render: () => null } },
  ] });
  await router.push("/documents");
  const wrapper = mount(RouteDocuments, { global: { plugins: [router], stubs } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
const menuItem = (wrapper, title) => wrapper.findAll(".document-action-menu button").find((item) => item.text() === title);
beforeEach(() => {
  jest.clearAllMocks();
  API.get.mockReset();
  API.delete.mockReset();
  API.get.mockResolvedValue([row()]);
  jest.spyOn(window, "confirm").mockReturnValue(false);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  jest.restoreAllMocks();
});

test("one page reads once; long names, chemical identity and all operations remain reachable", async () => {
  const title = "先导系列的完整研究名称".repeat(12);
  const smiles = "[13CH3][C@@H](O)C(=O)[O-].[Na+]";
  API.get.mockResolvedValueOnce([row("long-name", { title, target_smiles: smiles })]);
  const wrapper = await setup();
  expect(API.get.mock.calls).toEqual([["/api/v1/route-documents", { limit: 50, offset: 0 }]]);
  expect(wrapper.get(".document-title-cell strong").text()).toBe(title);
  expect(wrapper.get(".document-title-cell strong").attributes("title")).toBe(title);
  expect(wrapper.get("[data-smiles]").attributes("data-smiles")).toBe(smiles);
  expect(wrapper.get(".workspace-code").text()).toBe(smiles);
  expect(wrapper.get(".document-title-cell").attributes("href")).toBe("/editor/long-name");
  expect(wrapper.findAll(".document-row-actions button[aria-label]")).toHaveLength(2);
  expect(menuItem(wrapper, "打开编辑").attributes("data-to")).toBe("/editor/long-name");
  expect(menuItem(wrapper, "删除文档").exists()).toBe(true);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test("structure inspection and drawing retry are separate from the editor navigation", async () => {
  const wrapper = await setup();
  const retry = wrapper.get('[aria-label="重试结构加载"]');
  expect(retry.element.closest("a")).toBeNull();
  expect(wrapper.get('[aria-label="放大目标化合物"]').exists()).toBe(true);
  await retry.trigger("click");
  expect(wrapper.vm.$router.currentRoute.value.path).toBe("/documents");
  expect(API.post).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test("English and Chinese inspection labels update without translating a saved title or structure", async () => {
  const wrapper = await setup();
  const title = wrapper.get(".document-title-cell strong").text();
  const smiles = wrapper.get(".workspace-code").text();
  setLocale("en", { persist: false });
  await flushPromises();
  expect(wrapper.get('[aria-label="Enlarge Target compound"]').exists()).toBe(true);
  expect(wrapper.get(".document-title-cell strong").text()).toBe(title);
  expect(wrapper.get(".workspace-code").text()).toBe(smiles);
  expect(API.get).toHaveBeenCalledTimes(1);
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get('[aria-label="放大目标化合物"]').exists()).toBe(true);
});

test("unread, empty and failed states stay distinct and loading never displays an empty table", async () => {
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const wrapper = await setup();
  expect(wrapper.attributes("aria-busy")).toBe("true");
  expect(wrapper.get(".document-loading").text()).toBe("正在读取保存的路线");
  expect(wrapper.find(".document-empty").exists()).toBe(false);
  expect(wrapper.find("table").exists()).toBe(false);
  finish([]);
  await flushPromises();
  expect(wrapper.get(".document-empty h2").text()).toBe("暂无保存的路线");
  API.get.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "连接失败" })));
  await wrapper.get('[aria-label="刷新文档"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("连接失败");
  expect(wrapper.find(".document-empty").exists()).toBe(false);
  API.get.mockResolvedValueOnce([row()]);
  await wrapper.get('[role="alert"] button').trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
});

test("search emptiness is limited to loaded records; reset does not discard documents", async () => {
  const documents = Array.from({ length: 50 }, (_, index) => row(`document-${index}`));
  API.get.mockResolvedValueOnce(documents);
  const wrapper = await setup();
  await wrapper.get('[aria-label="搜索保存的路线"]').setValue("不匹配");
  expect(wrapper.get(".document-empty h2").text()).toBe("已加载路线中无匹配项");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.get(".document-pagination button").text()).toBe("加载更多");
  await wrapper.get(".document-empty button").trigger("click");
  expect(wrapper.findAll("tbody tr")).toHaveLength(50);
  expect(API.get).toHaveBeenCalledTimes(1);
});

test("failed pagination preserves loaded rows and retries the same offset", async () => {
  API.get.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => row(`document-${index}`)));
  const wrapper = await setup();
  API.get.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "分页读取失败" })));
  await wrapper.get(".document-pagination button").trigger("click");
  await flushPromises();
  expect(wrapper.findAll("tbody tr")).toHaveLength(50);
  API.get.mockResolvedValueOnce([row("next-page")]);
  await wrapper.get('[role="alert"] button').trigger("click");
  await flushPromises();
  expect(API.get.mock.calls.at(-1)).toEqual(["/api/v1/route-documents", { limit: 50, offset: 50 }]);
  expect(wrapper.findAll("tbody tr")).toHaveLength(51);
  expect(wrapper.find(".document-pagination").exists()).toBe(false);
});

test("preview pending state blocks duplicate operations and opens only the retrieved document", async () => {
  const wrapper = await setup();
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const preview = wrapper.get('[aria-label="预览文档：先导系列路线"]');
  await preview.trigger("click");
  expect(preview.element.disabled).toBe(true);
  expect(menuItem(wrapper, "删除文档").element.disabled).toBe(true);
  await preview.trigger("click");
  expect(API.get).toHaveBeenCalledTimes(2);
  const document = savedDocument();
  finish(document);
  await flushPromises();
  expect(wrapper.findComponent(DocumentPreview).props()).toMatchObject({ modelValue: true, document });
  expect(API.get.mock.calls[1]).toEqual(["/api/v1/route-documents/document-a", null, false]);
  expect(API.post).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
});

test("preview failure keeps loaded records and a direct retry remains possible", async () => {
  const wrapper = await setup();
  API.get.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "预览读取失败" })));
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("预览读取失败");
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
  API.get.mockResolvedValueOnce(savedDocument());
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.findComponent(DocumentPreview).props("modelValue")).toBe(true);
});

test("preview rejects another document's response without opening or replacing a route", async () => {
  const wrapper = await setup();
  API.get.mockResolvedValueOnce(savedDocument("document-b"));
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("路线文档标识与请求不一致");
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
});

test("background refresh keeps loaded routes readable and disables deletion until it settles", async () => {
  const wrapper = await setup();
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get('[aria-label="刷新文档"]').trigger("click");
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  expect(menuItem(wrapper, "删除文档").element.disabled).toBe(true);
  await menuItem(wrapper, "删除文档").trigger("click");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(API.delete).not.toHaveBeenCalled();
  finish([row()]);
  await flushPromises();
  expect(menuItem(wrapper, "删除文档").element.disabled).toBe(false);
});

test("the delete menu preserves confirmation and prevents duplicate requests while pending", async () => {
  const wrapper = await setup();
  await menuItem(wrapper, "删除文档").trigger("click");
  expect(window.confirm).toHaveBeenCalledWith("永久删除“先导系列路线”？此操作不可撤销。");
  expect(API.delete).not.toHaveBeenCalled();
  window.confirm.mockReturnValue(true);
  let finish;
  API.delete.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await menuItem(wrapper, "删除文档").trigger("click");
  await menuItem(wrapper, "删除文档").trigger("click");
  expect(API.delete).toHaveBeenCalledTimes(1);
  expect(API.delete).toHaveBeenCalledWith("/api/v1/route-documents/document-a", null, false);
  API.get.mockResolvedValueOnce([]);
  finish({ success: true });
  await flushPromises();
  expect(wrapper.get(".document-empty h2").text()).toBe("暂无保存的路线");
});

test("a late preview response after unmount cannot open a dialog", async () => {
  const wrapper = await setup();
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  wrapper.unmount();
  finish(row());
  await flushPromises();
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
  expect(API.get).toHaveBeenCalledTimes(2);
});

test.each(["../workspace/TaskList.vue", "../analyses/AnalysisList.vue", "RouteDocuments.vue"])(
  "owned history page %s compiles script, template and responsive styles", (relative) => {
    const filename = resolve(__dirname, relative);
    const { descriptor, errors } = parse(readFileSync(filename, "utf8"), { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "history-page" });
    expect(compileTemplate({ filename, id: "history-page", source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings } }).errors).toEqual([]);
    for (const style of descriptor.styles)
      expect(compileStyle({ filename, id: "history-page", source: style.content, scoped: true }).errors).toEqual([]);
  },
);
