import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import { setLocale } from "@/i18n";
import StockSearch from "./StockSearch.vue";
import { priceContractRecord } from "@/common/route-price-test-data";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";
import { randomUUID } from "node:crypto";

jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  name: "StructureInput", template: "<div />",
}));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview", props: ["smiles", "label", "inputType"],
  template: '<span class="matched-structure">{{ smiles }}</span>',
}));
const snapshot = "a".repeat(64),
  otherSnapshot = "b".repeat(64);
let inputPending;
const stubs = {
  ModuleWorkbench: { template: "<section><slot /></section>" },
  StructureInput: defineComponent({
    name: "StructureInput",
    props: ["modelValue"],
    emits: ["update:modelValue"],
    setup(props, { emit, expose }) {
      const pending = ref(false);
      inputPending = pending;
      expose({ pending });
      return () => h("textarea", { value: props.modelValue,
        onInput: (event) => emit("update:modelValue", event.target.value) });
    },
  }),
  VBtn: { template: "<button><slot /></button>" },
  VIcon: true,
  VProgressCircular: true,
};
const wrappers = [], hosts = [];
function setup(query = { smiles: "CCO", snapshot }) {
  const route = reactive({ query });
  useRoute.mockReturnValue(route);
  const router = { replace: jest.fn(async ({ query: nextQuery }) => { route.query = nextQuery; }) };
  useRouter.mockReturnValue(router);
  useWorkspaceStore.mockReturnValue({ health: {} });
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const wrapper = mount(StockSearch, { attachTo: host, global: { stubs } });
  wrappers.push(wrapper);
  return { route, router, wrapper };
}
function tab(wrapper, name) {
  return wrapper.findAll('[role="tab"]').find((item) => item.text() === name);
}
function panel(wrapper, name) {
  return wrapper.get(`#${tab(wrapper, name).attributes("aria-controls")}`);
}
function trackRuntimeErrors(wrapper) {
  const errors = jest.fn();
  wrapper.vm.$.appContext.config.errorHandler = errors;
  return errors;
}
async function lookup(wrapper, records = [{ smiles: "CCO", source: "supplier-a", catalog_id: "record-a" }], canonical = "CCO") {
  API.post.mockResolvedValueOnce({ smiles: canonical }).mockResolvedValueOnce({ snapshot, results: { [canonical]: records } });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}
beforeAll(() => Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID }));
beforeEach(() => {
  jest.clearAllMocks();
  API.post.mockReset();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  hosts.splice(0).forEach((host) => host.remove());
});

test("route prefill performs no lookup and a changed query resets both input and expected snapshot", async () => {
  const { route, wrapper } = setup();
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  expect(API.post).not.toHaveBeenCalled();
  route.query = { smiles: "O", snapshot: otherSnapshot };
  await nextTick();
  expect(wrapper.get("textarea").element.value).toBe("O");
  expect(API.post).not.toHaveBeenCalled();
});
test("response and task snapshots are labelled separately and missing prices remain unknown", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    snapshot: otherSnapshot,
    results: { CCO: [{ smiles: "CCO", catalog_id: "record-a", ppg: null }] },
  });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain(snapshot);
  expect(wrapper.text()).toContain(otherSnapshot);
  expect(wrapper.text()).toContain("快照不同");
  expect(wrapper.text()).toContain("价格未记录");
  expect(wrapper.text()).not.toMatch(/包装|纯度/);
  expect(wrapper.get(".stock-snapshot-warning").element.closest("details")).toBeNull();
  expect(wrapper.get(".stock-lead-time").text()).toBe("未记录");
});
test("catalog prices use the shared baseline and never present an inferred ISO currency", async () => {
  const { wrapper } = setup();
  const record = priceContractRecord();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({ snapshot, results: { CCO: [record] } });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("2.08 $/g");
  expect(wrapper.text()).toContain("非实时报价");
  expect(wrapper.text()).toContain("报价日期未记录");
  expect(wrapper.text()).not.toMatch(/USD|CNY|人民币/);
});
test("query changes immediately hide old records and do not automatically fetch replacement evidence", async () => {
  const { route, wrapper } = setup();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    snapshot,
    results: { CCO: [{ smiles: "CCO", catalog_id: "record-a" }] },
  });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.text()).toContain("record-a");
  route.query = { smiles: "O", snapshot: otherSnapshot };
  await nextTick();
  expect(wrapper.text()).not.toContain("record-a");
  expect(wrapper.find(".matched-structure").exists()).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(2);
});
test("supplier anchors use the shared safe URL boundary", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    snapshot,
    results: {
      CCO: [
        { smiles: "CCO", catalog_id: "one", url: "javascript:alert(1)" },
        {
          smiles: "CCO",
          catalog_id: "two",
          url: "https://user:password@example.org/catalog",
        },
        {
          smiles: "CCO",
          catalog_id: "three",
          url: "https://example.org/catalog",
        },
      ],
    },
  });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.findAll("a")).toHaveLength(1);
  expect(wrapper.get("a").attributes("href")).toBe(
    "https://example.org/catalog",
  );
});

test("matched stock structure uses the shared read-only preview without changing evidence", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    snapshot,
    results: { CCO: [{ smiles: "CCO", catalog_id: "record-a" }] },
  });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  const preview = wrapper.getComponent({ name: "StructurePreview" });
  expect(preview.props("smiles")).toBe("CCO");
  expect(preview.props("label")).toBe("规范化结构");
  expect(wrapper.text()).toContain("record-a");
  expect(API.post).toHaveBeenCalledTimes(2);
});

test("catalogue records wrap at 390 without truncating identity or breaking the evidence link", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "../../components/stock/StockRecordList.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const declarations = (selector) => Object.fromEntries(
    css.nodes.find((rule) => rule.selector === selector)?.nodes
      .filter((node) => node.type === "decl").map((node) => [node.prop, node.value]) || [],
  );
  expect(declarations(".catalog-link")["white-space"]).toBe("nowrap");
  expect(declarations(".catalog-link").display).toBe("inline-flex");
  expect(declarations(".stock-record dd")["overflow-wrap"]).toBe("anywhere");
  const narrow = css.nodes.find((rule) => rule.type === "atrule" && rule.params === "(max-width: 480px)");
  expect(narrow.nodes[0].nodes.find((node) => node.prop === "grid-template-columns").value).toBe("minmax(0, 1fr)");
  expect(css.toString()).not.toMatch(/min-width:\s*(560|220)px/);
});

test("catalogue lead time is shown unchanged and is never a live dispatch promise", async () => {
  const { wrapper } = setup();
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({
    snapshot, results: { CCO: [{ smiles: "CCO", catalog_id: "record-a", lead_time: "7-21days" }] },
  });
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get(".stock-lead-time").text()).toBe("7-21days");
  expect(wrapper.text()).toContain("非实时供货承诺");
  expect(wrapper.find(".stock-snapshot-warning").exists()).toBe(false);
});

test("cold query has linked reading layers with no visible blank output or premature supplier evidence", () => {
  const { wrapper } = setup({});
  expect(wrapper.findAll('[role="tab"]')).toHaveLength(3);
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
  expect(panel(wrapper, "目录记录").isVisible()).toBe(false);
  expect(panel(wrapper, "证据详情").isVisible()).toBe(false);
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
  expect(tab(wrapper, "证据详情").element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="stock-search-submit"]').element.disabled).toBe(true);
  wrapper.findAll('[role="tab"]').forEach((item) => {
    expect(document.getElementById(item.attributes("aria-controls")).getAttribute("aria-labelledby")).toBe(item.attributes("id"));
  });
  expect(API.post).not.toHaveBeenCalled();
});

test("completed lookup opens records, keeps the query draft mounted and edit restores source focus", async () => {
  const { wrapper } = setup({ smiles: "OCC", snapshot });
  const input = wrapper.get("textarea").element;
  await lookup(wrapper);
  expect(panel(wrapper, "查询").isVisible()).toBe(false);
  expect(panel(wrapper, "目录记录").isVisible()).toBe(true);
  expect(wrapper.get("textarea").element).toBe(input);
  expect(input.value).toBe("OCC");
  expect(document.activeElement).toBe(wrapper.get('[data-cy="stock-match-heading"]').element);
  await wrapper.get('[data-cy="stock-edit-query"]').trigger("click");
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("OCC");
  expect(API.post).toHaveBeenCalledTimes(2);
});

test("selected record opens separate evidence and returning restores its exact list control", async () => {
  const { wrapper } = setup();
  await lookup(wrapper, [{ smiles: "CCO", source: "supplier-a", catalog_id: "first" },
    { smiles: "CCO", source: "supplier-b", catalog_id: "second" }]);
  const origin = wrapper.findAll('[data-cy="stock-record-details"]')[1];
  origin.element.focus();
  await origin.trigger("click");
  await flushPromises();
  expect(panel(wrapper, "证据详情").isVisible()).toBe(true);
  expect(panel(wrapper, "目录记录").isVisible()).toBe(false);
  expect(panel(wrapper, "证据详情").text()).toContain("second");
  expect(panel(wrapper, "证据详情").text()).not.toContain("first");
  expect(panel(wrapper, "证据详情").text()).toContain(snapshot);
  expect(document.activeElement).toBe(wrapper.get('[data-cy="stock-evidence-heading"]').element);
  await wrapper.get('[data-cy="stock-back-records"]').trigger("click");
  expect(document.activeElement).toBe(origin.element);
  expect(API.post).toHaveBeenCalledTimes(2);
});

test("no-match presents the query structure without any supplier or purchasable success", async () => {
  const { wrapper } = setup();
  await lookup(wrapper, []);
  expect(panel(wrapper, "目录记录").text()).toContain("未找到精确目录记录");
  expect(wrapper.getComponent({ name: "StructurePreview" }).props("label")).toBe("规范化结构");
  expect(wrapper.find('[data-cy="stock-record-details"]').exists()).toBe(false);
  expect(panel(wrapper, "目录记录").text()).not.toContain("精确结构匹配");
  await tab(wrapper, "证据详情").trigger("click");
  expect(panel(wrapper, "证据详情").text()).toContain(snapshot);
  expect(panel(wrapper, "证据详情").text()).toContain("无精确目录记录");
});

test("pending confirmation gates lookup and invalidates old evidence without clearing its source", async () => {
  const { wrapper } = setup();
  inputPending.value = true;
  await nextTick();
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
  inputPending.value = false;
  await nextTick();
  await lookup(wrapper);
  inputPending.value = true;
  await nextTick();
  expect(wrapper.text()).not.toContain("record-a");
  expect(tab(wrapper, "证据详情").element.disabled).toBe(true);
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  inputPending.value = false;
  await nextTick();
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
});

test("editing then restoring the same source does not resurrect old evidence, and new query drops only task context", async () => {
  const { wrapper } = setup();
  await lookup(wrapper);
  await wrapper.get('[data-cy="stock-edit-query"]').trigger("click");
  await wrapper.get("textarea").setValue("O");
  await wrapper.get("textarea").setValue("CCO");
  expect(wrapper.text()).not.toContain("record-a");
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
  await lookup(wrapper);
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  expect(wrapper.get("textarea").element.value).toBe("");
  expect(document.activeElement).toBe(wrapper.get("textarea").element);
  expect(wrapper.text()).not.toContain("record-a");
  await wrapper.get("textarea").setValue("CCO");
  await lookup(wrapper);
  await tab(wrapper, "证据详情").trigger("click");
  expect(panel(wrapper, "证据详情").text()).not.toContain("任务快照 SHA256");
});

test("return and source replacement during lookup reject late errors and do not navigate or clear new text", async () => {
  const { wrapper } = setup();
  let reject;
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockReturnValueOnce(new Promise((_, no) => { reject = no; }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(panel(wrapper, "目录记录").text()).toContain("正在检索目录记录");
  await wrapper.get('[data-cy="stock-edit-query"]').trigger("click");
  await wrapper.get("textarea").setValue("O");
  reject(new Error("stale failure"));
  await flushPromises();
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
  expect(wrapper.get("textarea").element.value).toBe("O");
  expect(wrapper.text()).not.toContain("stale failure");
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
});

test("lookup failure is distinct from no-match and can be retried through the unchanged lookup chain", async () => {
  const { wrapper } = setup();
  API.post.mockRejectedValueOnce(new Error(JSON.stringify({ detail: "catalog unavailable" })));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(panel(wrapper, "目录记录").text()).toContain("catalog unavailable");
  expect(panel(wrapper, "目录记录").text()).not.toContain("未找到精确目录记录");
  expect(tab(wrapper, "证据详情").element.disabled).toBe(true);
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({ snapshot, results: { CCO: [] } });
  await wrapper.get('[data-cy="stock-retry"]').trigger("click");
  await flushPromises();
  expect(panel(wrapper, "目录记录").text()).toContain("未找到精确目录记录");
});

test("native reading tabs use roving keyboard focus and skip evidence until a confirmed response", async () => {
  const { wrapper } = setup();
  const query = tab(wrapper, "查询");
  query.element.focus();
  await query.trigger("keydown", { key: "End" });
  expect(document.activeElement).toBe(query.element);
  await lookup(wrapper);
  query.element.focus();
  await query.trigger("keydown", { key: "End" });
  await flushPromises();
  expect(document.activeElement).toBe(tab(wrapper, "证据详情").element);
  expect(panel(wrapper, "证据详情").isVisible()).toBe(true);
  await tab(wrapper, "证据详情").trigger("keydown", { key: "Home" });
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
});

test("a current completion after returning to query does not steal input focus or force result navigation", async () => {
  const { wrapper } = setup();
  let resolveLookup;
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockReturnValueOnce(new Promise((yes) => { resolveLookup = yes; }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  await wrapper.get('[data-cy="stock-edit-query"]').trigger("click");
  const input = wrapper.get("textarea").element;
  expect(document.activeElement).toBe(input);
  resolveLookup({ snapshot, results: { CCO: [{ smiles: "CCO", catalog_id: "record-a" }] } });
  await flushPromises();
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(tab(wrapper, "目录记录").element.disabled).toBe(false);
});

test("new unconfirmed input rejects an outstanding catalog success even when source text is unchanged", async () => {
  const { wrapper } = setup();
  let resolveLookup;
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockReturnValueOnce(new Promise((yes) => { resolveLookup = yes; }));
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  inputPending.value = true;
  await nextTick();
  resolveLookup({ snapshot, results: { CCO: [{ smiles: "CCO", catalog_id: "stale-record" }] } });
  await flushPromises();
  inputPending.value = false;
  await nextTick();
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  expect(wrapper.text()).not.toContain("stale-record");
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
  expect(panel(wrapper, "查询").isVisible()).toBe(true);
});

test("new query removes both structure aliases and task snapshot from the URL while preserving unrelated context", async () => {
  const { route, router, wrapper } = setup({ smiles: "CCO", q: "OCC", snapshot, context: "reading" });
  await lookup(wrapper);
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  await flushPromises();
  expect(router.replace).toHaveBeenCalledTimes(1);
  expect(route.query).toEqual({ context: "reading" });
  expect(wrapper.get("textarea").element.value).toBe("");
  expect(document.activeElement).toBe(wrapper.get("textarea").element);
  expect(tab(wrapper, "目录记录").element.disabled).toBe(true);
  expect(tab(wrapper, "证据详情").element.disabled).toBe(true);
  expect(API.post).toHaveBeenCalledTimes(2);
});

test("a superseding structure link during new-query navigation retains its own input and task snapshot", async () => {
  const { route, router, wrapper } = setup();
  await lookup(wrapper);
  let finishNavigation;
  router.replace.mockImplementation(() => new Promise((resolve) => { finishNavigation = resolve; }));
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  route.query = { smiles: "O", snapshot: otherSnapshot };
  await nextTick();
  finishNavigation();
  await flushPromises();
  expect(wrapper.get("textarea").element.value).toBe("O");
  await lookup(wrapper, [], "O");
  await tab(wrapper, "证据详情").trigger("click");
  expect(panel(wrapper, "证据详情").text()).toContain(otherSnapshot);
  expect(API.post).toHaveBeenCalledTimes(4);
});

test("rejected new-query navigation reports controlled feedback without clearing accepted input, records or snapshot", async () => {
  const { route, router, wrapper } = setup();
  const runtimeErrors = trackRuntimeErrors(wrapper);
  await lookup(wrapper);
  const input = wrapper.get("textarea").element, origin = document.activeElement;
  const acceptedQuery = route.query;
  router.replace.mockRejectedValueOnce(new Error("private router diagnostic"));
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  await flushPromises();
  expect(runtimeErrors).not.toHaveBeenCalled();
  expect(route.query).toBe(acceptedQuery);
  expect(wrapper.get("textarea").element).toBe(input);
  expect(input.value).toBe("CCO");
  expect(document.activeElement).toBe(origin);
  expect(panel(wrapper, "目录记录").isVisible()).toBe(true);
  expect(panel(wrapper, "目录记录").text()).toContain("record-a");
  expect(tab(wrapper, "证据详情").element.disabled).toBe(false);
  const feedback = wrapper.get('[data-cy="stock-navigation-error"]');
  expect(feedback.attributes("role")).toBe("alert");
  expect(feedback.text()).toBe("请求未完成，请重试。");
  expect(wrapper.text()).not.toContain("private router diagnostic");
  setLocale("en", { persist: false });
  await flushPromises();
  expect(feedback.text()).toBe("The request did not complete. Retry it.");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  await tab(wrapper, "证据详情").trigger("click");
  expect(panel(wrapper, "证据详情").text()).toContain(snapshot);
  await wrapper.get('[data-cy="stock-back-records"]').trigger("click");
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  await flushPromises();
  expect(wrapper.find('[data-cy="stock-navigation-error"]').exists()).toBe(false);
  expect(input.value).toBe("");
  expect(route.query).toEqual({});
  expect(API.post).toHaveBeenCalledTimes(2);
  expect(runtimeErrors).not.toHaveBeenCalled();
});

test("rejected new-query navigation after a superseding accepted structure cannot report stale feedback or reset it", async () => {
  const { route, router, wrapper } = setup();
  const runtimeErrors = trackRuntimeErrors(wrapper);
  await lookup(wrapper);
  let rejectNavigation;
  router.replace.mockImplementation(() => new Promise((_, reject) => { rejectNavigation = reject; }));
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  route.query = { smiles: "O", snapshot: otherSnapshot };
  await nextTick();
  await lookup(wrapper, [{ smiles: "O", catalog_id: "new-record" }], "O");
  rejectNavigation(new Error("obsolete router rejection"));
  await flushPromises();
  expect(runtimeErrors).not.toHaveBeenCalled();
  expect(wrapper.find('[data-cy="stock-navigation-error"]').exists()).toBe(false);
  expect(wrapper.get("textarea").element.value).toBe("O");
  expect(panel(wrapper, "目录记录").isVisible()).toBe(true);
  expect(panel(wrapper, "目录记录").text()).toContain("new-record");
  await tab(wrapper, "证据详情").trigger("click");
  expect(panel(wrapper, "证据详情").text()).toContain(otherSnapshot);
  expect(API.post).toHaveBeenCalledTimes(4);
});

test("rejected new-query navigation after unmount cannot escape through Vue runtime error handling", async () => {
  const { router, wrapper } = setup();
  const runtimeErrors = trackRuntimeErrors(wrapper);
  await lookup(wrapper);
  let rejectNavigation;
  router.replace.mockImplementation(() => new Promise((_, reject) => { rejectNavigation = reject; }));
  await wrapper.get('[data-cy="stock-new-query"]').trigger("click");
  wrappers.splice(wrappers.indexOf(wrapper), 1);
  wrapper.unmount();
  rejectNavigation(new Error("disposed router rejection"));
  await flushPromises();
  expect(runtimeErrors).not.toHaveBeenCalled();
  expect(API.post).toHaveBeenCalledTimes(2);
});
