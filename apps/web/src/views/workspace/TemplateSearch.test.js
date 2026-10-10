import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import { API } from "@/common/api";
import TemplateSearch from "./TemplateSearch.vue";
import { initializeLocale, setLocale } from "@/i18n";
import { randomUUID } from "node:crypto";
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/components/ModuleWorkbench.vue", () => ({
  template: "<section><slot /></section>",
}));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview",
  props: ["smiles", "inputType", "label"],
  template: '<div class="isolated-preview"><button type="button">Magnify</button><code>{{ smiles }}</code></div>',
}));

const row = (id) => ({
  template_id: `isolated:${id}`, source: "isolated", template_set: "isolated",
  reaction_smarts: "[C:1]=[O:2]>>[C:1]-[O:2]", count: 12, direction: "retro",
  domain: "strict_synthesis", necessary_reagent: "", intra_only: false, dimer_only: false,
  attributes: {}, references: [], raw: { _id: id, index: 1, template_set: "isolated" },
});
const rows = [row("one"), row("two")];
const followingRows = [row("u-third"), row("v-fourth")];
const lastRow = row("z-last");
const response = (templates, matched_count = templates.length, next_cursor = null) => ({
  count: templates.length, templates, matched_count, next_cursor, has_more: next_cursor !== null,
});
const wrappers = [];
const stubs = {
  VSelect: { props: ["modelValue", "label", "disabled", "items"], template: '<label>{{ label }}<select :disabled="disabled" /></label>' },
  VTextField: { props: ["modelValue", "label", "disabled"], template: '<label>{{ label }}<input :value="modelValue" :disabled="disabled" /></label>' },
  VBtn: { props: ["disabled", "loading", "type", "icon"], template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VTooltip: { props: ["text"], template: '<span><slot name="activator" :props="{}" /></span>' },
  VLazy: { template: '<div><slot /></div>' },
  VIcon: true, VProgressLinear: true,
};

async function setup(query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/template", component: TemplateSearch }],
  });
  await router.push({ path: "/template", query });
  await router.isReady();
  const wrapper = mount({ template: '<main class="workspace-page"><router-view /></main>' }, {
    attachTo: document.body, global: { plugins: [router], stubs },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}
beforeEach(() => {
  API.get.mockReset().mockImplementation(async (path, selection) => path.endsWith("/health")
    ? { status: "ready", template_count: 252029, source_count: 1, sources: ["isolated"], directions: { retro: 252029 } }
    : { template: [...rows, ...followingRows, lastRow].find((value) => value.template_id === selection.template_id) });
  API.post.mockReset().mockImplementation(async (_, body) => {
    if (body.cursor === "page-b") return response(followingRows, 5, "page-c");
    if (body.cursor === "page-c") return response([lastRow], 5);
    return body.limit === 2 ? response(rows, 5, "page-b") : response(rows);
  });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("template controls retain intrinsic height independently of result and detail length", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TemplateSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const rule = css.nodes.find((node) => node.selector === ".template-controls");
  expect(rule?.nodes.find((node) => node.prop === "align-self")?.value).toBe("start");
});

test("sticky filters are confined to wide, tall desktop screens and remain bounded in the workspace scroller", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TemplateSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const sticky = [];
  css.walkRules(".template-controls", (rule) => {
    if (rule.nodes.some((node) => node.prop === "position" && node.value === "sticky")) sticky.push(rule);
  });
  expect(sticky).toHaveLength(1);
  expect(sticky[0].parent.name).toBe("media");
  expect(sticky[0].parent.params).toBe("(min-width: 1200px) and (min-height: 800px)");
  const declarations = Object.fromEntries(sticky[0].nodes.map((node) => [node.prop, node.value]));
  expect(declarations).toMatchObject({ top: "16px", "max-height": "calc(100dvh - 180px)", "overflow-y": "auto" });
  const base = css.nodes.find((node) => node.selector === ".template-controls");
  expect(base.nodes.find((node) => node.prop === "position")?.value).toBe("static");
});

test("a direction missing from the index is not represented as an ordinary no-match query", async () => {
  API.get.mockResolvedValue({ status: "ready", template_count: 252029, source_count: 1, sources: ["isolated"], directions: { retro: 252029 } });
  const { wrapper } = await setup({ direction: "forward", searched: "1" });
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("当前索引未包含正向模板");
  expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true);
  const direction = wrapper.findAllComponents(stubs.VSelect).find((field) => field.props("label") === "反应方向");
  expect(direction.props("items").find((item) => item.value === "forward").props.disabled).toBe(true);
  expect(direction.props("items").find((item) => item.value === "forward").props["aria-disabled"]).toBe(true);
  expect(direction.props("items").find((item) => item.value === "retro").props["aria-disabled"]).toBeUndefined();
});

test("English index coverage explains a missing direction and changes language without a query or filter reset", async () => {
  initializeLocale(null);
  API.get.mockResolvedValue({ status: "ready", template_count: 252029, source_count: 1, sources: ["isolated"], directions: { retro: 252029 } });
  const { wrapper, router } = await setup({ direction: "forward", searched: "1" });
  expect(wrapper.get('p[role="status"]').text()).toBe("The current index contains no Forward templates.");
  const button = wrapper.get('button[type="submit"]');
  expect(button.element.disabled).toBe(true);
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.get('p[role="status"]').text()).toBe("当前索引未包含正向模板。");
  expect(wrapper.get('button[type="submit"]').element).toBe(button.element);
  expect(router.currentRoute.value.query).toEqual({ direction: "forward", searched: "1" });
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(API.post).not.toHaveBeenCalled();
});

test("list and detail reuse template-aware previews while original SMARTS and identities remain exact", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  const previews = wrapper.findAllComponents({ name: "StructurePreview" });
  expect(previews).toHaveLength(2);
  expect(previews.every((preview) => preview.props("inputType") === "template")).toBe(true);
  expect(previews[0].props("smiles")).toBe(rows[0].reaction_smarts);
  expect(wrapper.get(".template-result-row").element.tagName).toBe("ARTICLE");
  expect(wrapper.find("button button").exists()).toBe(false);
  await wrapper.get(".template-open").trigger("click");
  await flushPromises();
  expect(wrapper.getComponent({ name: "StructurePreview" }).props("smiles")).toBe(rows[0].reaction_smarts);
  expect(wrapper.get(".template-details pre").text()).toBe(rows[0].reaction_smarts);
  expect(wrapper.get(".template-details").text()).toContain(rows[0].raw._id);
});

test("index, filtered total and current page counts are separate and pager icons have names/tooltips", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".template-index-count").text()).toContain("252,029");
  expect(wrapper.get(".template-result-count").text()).toContain("2");
  expect(wrapper.get(".template-matched-count").text()).toBe("筛选匹配 5 条模板");
  expect(wrapper.get(".template-page-summary").text()).toContain("第 1 页");
  expect(wrapper.find(".template-limit-note").exists()).toBe(false);
  const pager = wrapper.get('[aria-label="模板列表分页"]');
  const buttons = pager.findAllComponents(stubs.VBtn);
  expect(buttons.map((button) => [button.attributes("aria-label"), button.props("icon")])).toEqual([
    ["返回首页", "mdi-page-first"], ["上一页", "mdi-chevron-left"], ["下一页", "mdi-chevron-right"],
  ]);
  expect(pager.findAllComponents(stubs.VTooltip).map((tooltip) => tooltip.props("text"))).toEqual(["返回首页", "上一页", "下一页"]);
  expect(wrapper.findAllComponents(stubs.VTextField).map((field) => field.props("label"))).toContain("每页条数");
  expect(API.post).toHaveBeenCalledWith("/api/v1/template-library/query", {
    sources: [], direction: "retro", min_count: 0, limit: 2,
  }, false, expect.objectContaining({ timeoutMs: 15000 }));
});

test("below-limit results report their real returned count without claiming truncation or full DB paging", async () => {
  API.post.mockResolvedValue(response([rows[0]]));
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".template-result-count").text()).toContain("1");
  expect(wrapper.find(".template-limit-note").exists()).toBe(false);
});

test("a query row without normalized source identity cannot be guessed from raw native fields", async () => {
  const legacy = { ...rows[0] };
  delete legacy.template_id;
  delete legacy.source;
  delete legacy.template_set;
  API.post.mockResolvedValue(response([legacy]));
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".tool-error").text()).toContain("模板分页响应无效");
  expect(wrapper.find(".template-open").exists()).toBe(false);
});

test("malformed returned counts never become displayed result totals", async () => {
  API.post.mockResolvedValue({ ...response([rows[0]]), count: 252029 });
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".tool-error").text()).toContain("模板分页响应无效");
  expect(wrapper.find(".template-result-count").exists()).toBe(false);
  expect(wrapper.find(".template-open").exists()).toBe(false);
});

test.each([null, undefined, "", 0])("invalid SMARTS field %p is rejected before the preview receives it", async (reaction_smarts) => {
  API.post.mockResolvedValue(response([{ ...rows[0], reaction_smarts }]));
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".tool-error").text()).toContain("模板分页响应无效");
  expect(wrapper.find(".template-open").exists()).toBe(false);
});

test.each([null, undefined, "unknown", -1])("unrecorded index total %p never becomes zero or NaN", async (template_count) => {
  API.get.mockResolvedValueOnce({ template_count, sources: [] });
  const { wrapper } = await setup();
  expect(wrapper.get(".template-index-count").text()).toContain("未提供");
  expect(wrapper.get(".template-index-count").text()).not.toMatch(/NaN|\b0\b/);
});

test("a malformed deep-link drawing is a detail error, not a crashing preview", async () => {
  API.get.mockImplementation(async (path) => path.endsWith("/health")
    ? { status: "ready", template_count: 252029, source_count: 1, sources: ["isolated"], directions: { retro: 252029 } }
    : { template: { ...rows[0], reaction_smarts: null } });
  const { wrapper } = await setup({ source: "isolated", id: rows[0].template_id });
  expect(wrapper.get(".tool-error").text()).toContain("模板记录返回格式无效");
  expect(wrapper.findComponent({ name: "StructurePreview" }).exists()).toBe(false);
});

test("a genuine zero in index metadata remains a recorded zero", async () => {
  API.get.mockResolvedValueOnce({ status: "ready", template_count: 0, source_count: 0, sources: [], directions: {} });
  const { wrapper } = await setup();
  expect(wrapper.get(".template-index-count").text()).toBe("索引总量 0 条模板记录");
});

test("return and browser back restore the namespaced trigger and internal list scroll", async () => {
  const { wrapper, router } = await setup({ limit: "2", searched: "1" });
  const scroller = wrapper.get(".workspace-page").element;
  scroller.scrollTop = 3003;
  const trigger = wrapper.findAll(".template-open")[1];
  trigger.element.focus();
  await trigger.trigger("click");
  await flushPromises();
  scroller.scrollTop = 0;
  await wrapper.get(".template-back").trigger("click");
  await flushPromises();
  expect(scroller.scrollTop).toBe(3003);
  expect(document.activeElement.dataset.templateId).toBe(rows[1].template_id);
  await wrapper.findAll(".template-open")[1].trigger("click");
  await flushPromises();
  scroller.scrollTop = 0;
  router.back();
  await flushPromises();
  expect(document.activeElement.dataset.templateId).toBe(rows[1].template_id);
  expect(scroller.scrollTop).toBe(3003);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("reading a detail preserves the list's native SMARTS disclosure state", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  const disclosure = wrapper.get(".template-row-code").element;
  disclosure.open = true;
  await wrapper.findAll(".template-open")[1].trigger("click");
  await flushPromises();
  expect(disclosure.isConnected).toBe(true);
  await wrapper.get(".template-back").trigger("click");
  await flushPromises();
  expect(wrapper.get(".template-row-code").element).toBe(disclosure);
  expect(disclosure.open).toBe(true);
});

test("next/previous/first fetch whole server pages, update the URL, and focus the new page summary", async () => {
  const { wrapper, router } = await setup({ limit: "2", searched: "1" });
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[1][1].cursor).toBe("page-b");
  expect(router.currentRoute.value.query.cursor).toBe("page-b");
  expect(wrapper.findAll(".template-open").map((button) => button.attributes("data-template-id")))
    .toEqual(followingRows.map((record) => record.template_id));
  expect(document.activeElement).toBe(wrapper.get(".template-page-summary").element);
  expect(wrapper.get(".template-page-summary").text()).toContain("第 2 页");
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".template-result-count").text()).toBe("当前页 1 条模板");
  expect(wrapper.get('[aria-label="下一页"]').element.disabled).toBe(true);
  await wrapper.get('[aria-label="上一页"]').trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[3][1].cursor).toBe("page-b");
  await wrapper.get('[aria-label="返回首页"]').trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[4][1]).not.toHaveProperty("cursor");
  expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  expect(wrapper.get('[aria-label="上一页"]').element.disabled).toBe(true);
});

test("direct cursor reload cannot guess a previous cursor or ordinal, but can return to first", async () => {
  const { wrapper, router } = await setup({ limit: "2", cursor: "page-b" });
  expect(API.post.mock.calls[0][1].cursor).toBe("page-b");
  expect(wrapper.get('[aria-label="上一页"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="返回首页"]').element.disabled).toBe(false);
  expect(wrapper.get(".template-page-summary").text()).not.toMatch(/第 \d+ 页/);
  await wrapper.get('[aria-label="返回首页"]').trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
  expect(wrapper.get(".template-page-summary").text()).toContain("第 1 页");
});

test.each([409, 422])("failed cursor page %i offers same-page retry and explicit new search, never no matches", async (status) => {
  API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: `cursor ${status}` })));
  const { wrapper, router } = await setup({ limit: "2", searched: "1", cursor: "page-b" });
  expect(wrapper.get(".tool-error").text()).toContain(`cursor ${status}`);
  expect(wrapper.find(".workspace-empty").exists()).toBe(false);
  expect(wrapper.find(".template-result-count").exists()).toBe(false);
  await wrapper.get(".template-retry").trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[1][1].cursor).toBe("page-b");
  expect(router.currentRoute.value.query.cursor).toBe("page-b");
  API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: `cursor ${status}` })));
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get(".tool-error").element);
  await wrapper.get(".template-new-search").trigger("click");
  await flushPromises();
  expect(API.post.mock.calls[3][1]).not.toHaveProperty("cursor");
  expect(router.currentRoute.value.query).not.toHaveProperty("cursor");
});

test("paging controls remain mounted and single-flight while filters and duplicate actions are disabled", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  let release;
  API.post.mockImplementationOnce(() => new Promise((yes) => { release = yes; }));
  const next = wrapper.get('[aria-label="下一页"]').element;
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[aria-label="下一页"]').element).toBe(next);
  expect(next.disabled).toBe(true);
  expect(wrapper.get('[aria-label="上一页"]').element.disabled).toBe(true);
  expect(wrapper.get('[aria-label="返回首页"]').element.disabled).toBe(true);
  expect(wrapper.findAll(".template-controls input, .template-controls select").every((field) => field.element.disabled)).toBe(true);
  expect(wrapper.find(".template-open").exists()).toBe(false);
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  expect(API.post).toHaveBeenCalledTimes(2);
  release(response(followingRows, 5, "page-c"));
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get(".template-page-summary").element);
});

test("detail/back on a later page preserves cursor, lower-row focus and disclosures; paging clears old context", async () => {
  const { wrapper, router } = await setup({ limit: "2", searched: "1" });
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  const disclosure = wrapper.get(".template-row-code").element;
  disclosure.open = true;
  const scroller = wrapper.get(".workspace-page").element;
  scroller.scrollTop = 2000;
  await wrapper.findAll(".template-open")[1].trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query.cursor).toBe("page-b");
  scroller.scrollTop = 0;
  await wrapper.get(".template-back").trigger("click");
  await flushPromises();
  expect(router.currentRoute.value.query.cursor).toBe("page-b");
  expect(scroller.scrollTop).toBe(2000);
  expect(document.activeElement.dataset.templateId).toBe(followingRows[1].template_id);
  expect(wrapper.get(".template-row-code").element).toBe(disclosure);
  expect(disclosure.open).toBe(true);
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  expect(disclosure.isConnected).toBe(false);
  expect(document.activeElement).toBe(wrapper.get(".template-page-summary").element);
  expect(wrapper.get(".template-row-code").element.open).toBe(false);
});

test("genuine empty filtered pages display zero counts without a false error", async () => {
  API.post.mockResolvedValue(response([]));
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".workspace-empty").text()).toContain("没有匹配的模板");
  expect(wrapper.get(".template-matched-count").text()).toContain("0");
  expect(wrapper.get(".template-result-count").text()).toContain("0");
  expect(wrapper.find(".tool-error").exists()).toBe(false);
  expect(wrapper.get('[aria-label="下一页"]').element.disabled).toBe(true);
});

test("unmount during paging cannot refocus detached controls or restore an old return point", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  let release;
  API.post.mockImplementationOnce(() => new Promise((yes) => { release = yes; }));
  const summary = wrapper.get(".template-page-summary").element;
  const focus = jest.spyOn(summary, "focus");
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  await flushPromises();
  wrapper.unmount();
  release(response(followingRows, 5, "page-c"));
  await flushPromises();
  expect(focus).not.toHaveBeenCalled();
});

test("template detail hides retained controls and leads with a chemical label while retaining exact identity in technical details", async () => {
  const { wrapper, router } = await setup({ limit: "2", searched: "1", min_count: "4" });
  const controls = wrapper.get(".template-controls").element;
  const disclosure = wrapper.get(".template-row-code").element;
  disclosure.open = true;
  const scroller = wrapper.get(".workspace-page").element;
  scroller.scrollTop = 3003;
  const trigger = wrapper.findAll(".template-open")[1];
  trigger.element.focus();
  await trigger.trigger("click");
  await flushPromises();
  expect(wrapper.get(".template-controls").element).toBe(controls);
  expect(wrapper.get(".template-controls").isVisible()).toBe(false);
  expect(wrapper.get(".tool-layout").classes()).toContain("template-detail-layout");
  expect(scroller.scrollTop).toBe(0);
  expect(document.activeElement).toBe(wrapper.get(".template-back").element);
  const identity = wrapper.get(".template-reading h2").element;
  const preview = wrapper.get(".template-reading .isolated-preview").element;
  expect(identity.textContent).toBe("逆合成模板");
  expect(wrapper.get('[data-section="technical"]').text()).toContain(rows[1].template_id);
  expect(identity.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(wrapper.get(".template-reading pre").text()).toBe(rows[1].reaction_smarts);
  expect(router.currentRoute.value.query).toMatchObject({ limit: "2", min_count: "4", searched: "1" });
  await wrapper.get(".template-back").trigger("click");
  await flushPromises();
  expect(wrapper.get(".template-controls").element).toBe(controls);
  expect(wrapper.get(".template-controls").isVisible()).toBe(true);
  expect(wrapper.get(".template-row-code").element).toBe(disclosure);
  expect(disclosure.open).toBe(true);
  expect(document.activeElement.dataset.templateId).toBe(rows[1].template_id);
  expect(scroller.scrollTop).toBe(3003);
  expect(API.post).toHaveBeenCalledTimes(1);
});

test("a detail-only layout removes the old fixed filter track at every viewport", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TemplateSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const rule = css.nodes.find((node) => node.selector === ".tool-layout.template-detail-layout");
  expect(rule?.nodes.find((node) => node.prop === "grid-template-columns")?.value).toBe("minmax(0, 1fr)");
});

test("template search, paging, detail navigation and retry controls have stable touch dimensions", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TemplateSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const values = selector => Object.fromEntries((css.nodes.find(rule => rule.selector === selector)?.nodes || [])
    .filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  expect(values(".tool-layout :deep(.v-btn)")).toMatchObject({ "min-height": "44px", height: "44px" });
  expect(values(".tool-layout :deep(.v-btn--icon)")).toMatchObject({ width: "44px", "min-width": "44px" });
});

test("a direct detail error still hides disabled filters and retains the existing back/retry layer", async () => {
  API.get.mockImplementation(async (path) => path.endsWith("/health")
    ? { status: "ready", template_count: 252029, source_count: 1, sources: ["isolated"], directions: { retro: 252029 } }
    : Promise.reject(new Error("detail unavailable")));
  const { wrapper } = await setup({ source: "isolated", id: rows[0].template_id });
  expect(wrapper.get(".template-controls").isVisible()).toBe(false);
  expect(wrapper.find(".template-back").exists()).toBe(true);
  expect(wrapper.get(".tool-error").text()).toContain("模板详情读取失败");
});

test("the index error retry reuses the current controls and never creates a query intent", async () => {
  API.get.mockRejectedValueOnce(new Error("offline"));
  const { wrapper, router } = await setup({ filter_source: "isolated", limit: "3" });
  const input = wrapper.get('input').element;
  const retry = wrapper.get('.template-index-error button');
  await retry.trigger("click");
  await flushPromises();
  expect(wrapper.find('.template-index-error').exists()).toBe(false);
  expect(wrapper.get('input').element).toBe(input);
  expect(router.currentRoute.value.query.filter_source).toBe("isolated");
  expect(API.post).not.toHaveBeenCalled();
  expect(API.get).toHaveBeenCalledTimes(2);
});
