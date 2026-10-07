import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import StockSearch from "./StockSearch.vue";
import { priceContractRecord } from "@/common/route-price-test-data";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";

jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({
  name: "StructureInput",
  template: "<div />",
}));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({
  name: "StructurePreview", props: ["smiles", "label", "inputType"],
  template: '<span class="matched-structure">{{ smiles }}</span>',
}));
const snapshot = "a".repeat(64),
  otherSnapshot = "b".repeat(64);
const stubs = {
  ModuleWorkbench: { template: "<section><slot /></section>" },
  StructureInput: {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template:
      '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  VBtn: { template: "<button><slot /></button>" },
  VIcon: true,
  VProgressCircular: true,
};
const wrappers = [];
function setup() {
  const route = reactive({ query: { smiles: "CCO", snapshot } });
  useRoute.mockReturnValue(route);
  useWorkspaceStore.mockReturnValue({ health: {} });
  const wrapper = mount(StockSearch, { global: { stubs } });
  wrappers.push(wrapper);
  return { route, wrapper };
}
beforeEach(() => {
  jest.clearAllMocks();
  API.post.mockReset();
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

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
  expect(wrapper.text()).toContain("record-a");
  expect(API.post).toHaveBeenCalledTimes(2);
});

test("catalogue evidence reserves a readable column and unbroken link label on mobile", () => {
  const { descriptor } = parse(readFileSync(resolve(__dirname, "StockSearch.vue"), "utf8"));
  const css = postcss.parse(descriptor.styles[0].content);
  const declarations = (selector) => Object.fromEntries(
    css.nodes.find((rule) => rule.selector === selector)?.nodes
      .filter((node) => node.type === "decl").map((node) => [node.prop, node.value]) || [],
  );
  expect(declarations(".catalog-link")["white-space"]).toBe("nowrap");
  expect(declarations(".catalog-link").display).toBe("inline-flex");
  expect(declarations(".stock-evidence-cell")["min-width"]).toBe("100px");
  expect(declarations(".stock-records-scroll")["overflow-x"]).toBe("auto");
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
