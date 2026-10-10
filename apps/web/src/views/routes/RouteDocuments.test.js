import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse, compileScript, compileStyle, compileTemplate } from "@vue/compiler-sfc";
import { API } from "@/common/api";
import RouteDocuments from "./RouteDocuments.vue";
import DocumentPreview from "@/components/routes/DocumentPreview.vue";
import StructurePreview from "@/components/workspace/StructurePreview.vue";
import { setLocale } from "@/i18n";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("@/components/SmilesImage.vue", () => ({
  props: ["smiles"], template: '<div :data-smiles="smiles"><button aria-label="重试结构加载" /></div>',
}));
jest.mock("@/components/routes/DocumentPreview.vue", () => ({
  props: ["modelValue", "document", "focusTicket"], template: "<div />",
}));

const stubs = {
  VDefaultsProvider: { template: "<slot />" },
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
async function setup(path = "/documents") {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/documents", component: { render: () => null } },
    { path: "/editor/:id?", component: { render: () => null } },
  ] });
  await router.push(path);
  const wrapper = mount(RouteDocuments, { attachTo: document.body, global: { plugins: [router], stubs } });
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
  expect(wrapper.findAll('thead th').map(cell => cell.text())).toEqual(["目标化合物", "路线", "反应", "更新时间", "操作"]);
  expect(wrapper.getComponent(StructurePreview).props()).toMatchObject({ compact: true, width: 180, height: 96 });
});

test("sorting is URL-owned, scoped to loaded rows and preserves the original title and chemical data", async () => {
  const documents = [row("a", { title: "Beta", reaction_count: 3 }), row("b", { title: "Alpha", reaction_count: 0 })];
  const original = JSON.stringify(documents); API.get.mockResolvedValueOnce(documents);
  const wrapper = await setup("/documents?query=a&other=keep");
  await wrapper.get('.document-sort select').setValue("reactions"); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query).toEqual({ query: "a", other: "keep", sort: "reactions" });
  expect(wrapper.findAll('tbody tr').map(row => row.attributes('data-document-id'))).toEqual(["b", "a"]);
  expect(wrapper.get('.document-toolbar [role="status"]').text()).toBe("显示 2 / 2 条路线");
  await wrapper.get('.document-search').setValue("Alpha"); await flushPromises();
  expect(wrapper.get('.document-toolbar [role="status"]').text()).toBe("显示 1 / 2 条路线");
  expect(JSON.stringify(documents)).toBe(original); expect(API.get).toHaveBeenCalledTimes(1);
});

test("overlapping pages advance by consumed server rows instead of unique rendered records", async () => {
  API.get.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => row(`document-${index}`)));
  const wrapper = await setup();
  API.get.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => row(`document-${index + 49}`)));
  await wrapper.get('.document-pagination button').trigger("click"); await flushPromises();
  expect(wrapper.findAll('tbody tr')).toHaveLength(99);
  API.get.mockResolvedValueOnce([]);
  await wrapper.get('.document-pagination button').trigger("click"); await flushPromises();
  expect(API.get.mock.calls.at(-1)).toEqual(["/api/v1/route-documents", { limit: 50, offset: 100 }]);
  expect(wrapper.find('.document-pagination').exists()).toBe(false);
});

test("an aborted sort navigation keeps the native control and URL on the same committed mode", async () => {
  const wrapper = await setup("/documents?sort=title");
  wrapper.vm.$router.beforeEach(() => false);
  await wrapper.get('.document-sort select').setValue("reactions"); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query.sort).toBe("title");
  expect(wrapper.get('.document-sort select').element.value).toBe("title");
  expect(API.get).toHaveBeenCalledTimes(1);
});

test("a sort intent retires a pending preview before a navigation guard completes", async () => {
  const wrapper = await setup();
  let finishPreview, finishNavigation;
  wrapper.vm.$router.beforeEach(() => new Promise(resolve => { finishNavigation = resolve; }));
  API.get.mockReturnValueOnce(new Promise(resolve => { finishPreview = resolve; }));
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  await wrapper.get('.document-sort select').setValue("title"); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query.sort).toBeUndefined();
  expect(wrapper.get('.document-sort select').element.value).toBe("updated");
  finishPreview(savedDocument()); await flushPromises();
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
  finishNavigation(true); await flushPromises();
  expect(wrapper.get('.document-sort select').element.value).toBe("title");
});

test("an invalid summary response remains an explicit error and does not replace readable records", async () => {
  const wrapper = await setup(); API.get.mockResolvedValueOnce({ invalid: true });
  await wrapper.get('[aria-label="刷新文档"]').trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("路线文档列表响应无效。");
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);
  expect(API.post).not.toHaveBeenCalled(); expect(API.delete).not.toHaveBeenCalled();
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
  await flushPromises();
  expect(wrapper.get(".document-empty h2").text()).toBe("已加载路线中无匹配项");
  expect(wrapper.find("table").exists()).toBe(false);
  expect(wrapper.get(".document-pagination button").text()).toBe("加载更多");
  await wrapper.get(".document-empty button").trigger("click");
  await flushPromises();
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

test("the URL owns the saved-route filter without extra reads or translating its content", async () => {
  API.get.mockResolvedValueOnce([row("a", { title: "Acceptance docs" }), row("b", { title: "Other" })]);
  const wrapper = await setup("/documents?query=Acceptance%20docs&other=keep");
  expect(wrapper.get('.document-search').element.value).toBe("Acceptance docs");
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);
  await wrapper.get('.document-search').setValue("Other"); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query).toEqual({ query: "Other", other: "keep" });
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);
  setLocale("en", { persist: false }); await flushPromises();
  expect(wrapper.get('.document-search').element.value).toBe("Other");
  expect(API.get).toHaveBeenCalledTimes(1);
});

test("changing the filter retires a pending preview and its late error cannot overwrite a newer read", async () => {
  API.get.mockResolvedValueOnce([row("a", { title: "First" }), row("b", { title: "Second" })]);
  const wrapper = await setup();
  let rejectFirst, resolveSecond;
  API.get.mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject; }));
  await wrapper.get('[aria-label="预览文档：First"]').trigger("click");
  await wrapper.get('.document-search').setValue("Second"); await flushPromises();
  expect(wrapper.get('[aria-label="预览文档：Second"]').element.disabled).toBe(false);
  API.get.mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
  await wrapper.get('[aria-label="预览文档：Second"]').trigger("click");
  rejectFirst(new Error("old read")); await flushPromises();
  expect(wrapper.get('[aria-label="预览文档：Second"]').element.disabled).toBe(true);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  resolveSecond(savedDocument("b")); await flushPromises();
  expect(wrapper.findComponent(DocumentPreview).props("document").id).toBe("b");
});

test("filter intent retires a preview before an asynchronous navigation guard commits the URL", async () => {
  API.get.mockResolvedValueOnce([row("a", { title: "First" }), row("b", { title: "Second" })]);
  const wrapper = await setup();
  let finishPreview, finishNavigation;
  wrapper.vm.$router.beforeEach(() => new Promise(resolve => { finishNavigation = resolve; }));
  API.get.mockReturnValueOnce(new Promise(resolve => { finishPreview = resolve; }));
  await wrapper.get('[aria-label="预览文档：First"]').trigger("click");
  await wrapper.get('.document-search').setValue("Second"); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query.query).toBeUndefined();
  finishPreview(savedDocument("a")); await flushPromises();
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  finishNavigation(true); await flushPromises();
  expect(wrapper.vm.$router.currentRoute.value.query.query).toBe("Second");
  expect(wrapper.findAll('tbody tr')).toHaveLength(1);
});

test("normal preview close returns to the connected origin after the dialog leaves", async () => {
  const wrapper = await setup();
  const trigger = wrapper.get('[aria-label="预览文档：先导系列路线"]').element;
  jest.spyOn(trigger, "getClientRects").mockReturnValue([{ width: 40, height: 40 }]);
  trigger.focus();
  API.get.mockResolvedValueOnce(savedDocument());
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click"); await flushPromises();
  const dialog = wrapper.findComponent(DocumentPreview);
  const close = document.createElement("button"); document.body.append(close); close.focus();
  dialog.vm.$emit("update:modelValue", false); await flushPromises();
  close.remove();
  dialog.vm.$emit("afterLeave", dialog.props("focusTicket")); await flushPromises();
  expect(document.activeElement).toBe(trigger);
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

test("preview rejects null renderer scores before opening the graph", async () => {
  const wrapper = await setup();
  API.get.mockResolvedValueOnce({ ...savedDocument(), prediction_scores: null });
  await wrapper.get('[aria-label="预览文档：先导系列路线"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("路线文档响应格式无效");
  expect(wrapper.findComponent(DocumentPreview).exists()).toBe(false);
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
