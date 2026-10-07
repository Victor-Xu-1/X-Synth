import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import { API } from "@/common/api";
import TemplateSearch from "./TemplateSearch.vue";

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
  attributes: {}, references: [], raw: { _id: id, index: 1, template_set: "isolated" },
});
const rows = [row("one"), row("two")];
const wrappers = [];
const stubs = {
  VSelect: { props: ["modelValue", "label", "disabled", "items"], template: '<label>{{ label }}<select :disabled="disabled" /></label>' },
  VTextField: { props: ["modelValue", "label", "disabled"], template: '<label>{{ label }}<input :value="modelValue" :disabled="disabled" /></label>' },
  VBtn: { props: ["disabled", "loading", "type"], template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
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
    ? { template_count: 252029, sources: ["isolated"] }
    : { template: rows.find((value) => value.template_id === selection.template_id) });
  API.post.mockReset().mockImplementation(async (_, body) => ({ count: body.limit, templates: rows.slice(0, body.limit) }));
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("template controls retain intrinsic height independently of result and detail length", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "TemplateSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const rule = css.nodes.find((node) => node.selector === ".template-controls");
  expect(rule?.nodes.find((node) => node.prop === "align-self")?.value).toBe("start");
});

test("a direction missing from the index is not represented as an ordinary no-match query", async () => {
  API.get.mockResolvedValue({ template_count: 252029, sources: ["isolated"], directions: { retro: 252029 } });
  const { wrapper } = await setup({ direction: "forward", searched: "1" });
  expect(API.post).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("当前索引未包含正向模板");
  expect(wrapper.get('button[type="submit"]').element.disabled).toBe(true);
  const direction = wrapper.findAllComponents(stubs.VSelect).find((field) => field.props("label") === "反应方向");
  expect(direction.props("items").find((item) => item.value === "forward").props.disabled).toBe(true);
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

test("index total and returned count are separate; reaching the limit is not a claimed DB total", async () => {
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".template-index-count").text()).toContain("252,029");
  expect(wrapper.get(".template-result-count").text()).toContain("2");
  expect(wrapper.get(".template-limit-note").text()).toContain("达到本次上限");
  expect(wrapper.get(".template-limit-note").text()).toContain("未提供");
  expect(wrapper.find('[aria-label="模板列表分页"]').exists()).toBe(false);
  expect(API.post).toHaveBeenCalledWith("/api/v1/template-library/query", {
    sources: [], direction: "retro", min_count: 0, limit: 2,
  });
});

test("below-limit results report their real returned count without claiming truncation or full DB paging", async () => {
  API.post.mockResolvedValue({ count: 1, templates: [rows[0]] });
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".template-result-count").text()).toContain("1");
  expect(wrapper.find(".template-limit-note").exists()).toBe(false);
});

test("legacy source and native ID still locate the template without guessing from training index", async () => {
  const legacy = { ...rows[0] };
  delete legacy.template_id;
  delete legacy.source;
  delete legacy.template_set;
  API.post.mockResolvedValue({ count: 1, templates: [legacy] });
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".template-open").attributes("data-template-id")).toBe(rows[0].template_id);
  await wrapper.get(".template-open").trigger("click");
  await flushPromises();
  expect(API.get).toHaveBeenCalledWith("/api/v1/template-library/template", {
    source: "isolated", template_id: rows[0].template_id,
  });
});

test("malformed returned counts never become displayed result totals", async () => {
  API.post.mockResolvedValue({ count: 252029, templates: [rows[0]] });
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".tool-error").text()).toContain("模板查询失败");
  expect(wrapper.find(".template-result-count").exists()).toBe(false);
  expect(wrapper.find(".template-open").exists()).toBe(false);
});

test.each([null, undefined, "", 0])("invalid SMARTS field %p is rejected before the preview receives it", async (reaction_smarts) => {
  API.post.mockResolvedValue({ count: 1, templates: [{ ...rows[0], reaction_smarts }] });
  const { wrapper } = await setup({ limit: "2", searched: "1" });
  expect(wrapper.get(".tool-error").text()).toContain("模板查询失败");
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
    ? { template_count: 252029, sources: ["isolated"] }
    : { template: { ...rows[0], reaction_smarts: null } });
  const { wrapper } = await setup({ source: "isolated", id: rows[0].template_id });
  expect(wrapper.get(".tool-error").text()).toContain("模板详情读取失败");
  expect(wrapper.findComponent({ name: "StructurePreview" }).exists()).toBe(false);
});

test("a genuine zero in index metadata remains a recorded zero", async () => {
  API.get.mockResolvedValueOnce({ template_count: 0, sources: [] });
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
