import { mount } from "@vue/test-utils";
import { runInThisContext } from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import RouteReviewSummary from "./RouteReviewSummary.vue";
import RouteReader from "./RouteReader.vue";

jest.mock("@vue-flow/core", () => ({ useVueFlow: () => ({ fitView: jest.fn() }) }));
jest.mock("@/common/route-export", () => ({ routeImage: jest.fn() }));
jest.mock("@/composables/useRouteCatalogPrices", () => ({
  useRouteCatalogPrices: () => {
    const { ref } = require("vue");
    return { prices: ref({}), error: ref("") };
  },
}));
jest.mock("./RouteGraph.vue", () => ({
  name: "RouteGraph", props: { graph: Object, editable: Boolean, reading: Boolean }, emits: ["select"],
  template: '<div class="test-route-graph" />', methods: { fit: jest.fn() },
}));
jest.mock("./RouteStepList.vue", () => ({
  name: "RouteStepList", props: ["candidate", "choices", "overview"],
  emits: ["choose", "edit", "select", "locate"], template: "<div />",
}));
jest.mock("./RouteFilters.vue", () => ({ name: "RouteFilters", template: "<div />" }));
jest.mock("./RouteInspector.vue", () => ({
  name: "RouteInspector", props: ["node", "step"], template: "<aside />",
}));
jest.mock("./RouteMaterials.vue", () => ({
  name: "RouteMaterials", props: ["graph", "expectedSnapshot"], template: "<div />",
}));
jest.mock("./RouteConditions.vue", () => ({
  name: "RouteConditions", props: ["candidate", "graph"], template: "<div />",
}));
jest.mock("./RouteEvidencePanel.vue", () => ({
  name: "RouteEvidencePanel", props: ["candidate"], template: "<div />",
}));

// Rendering fixtures, never a replacement for the real-model acceptance run.
function candidate(route_id = "reviewed") {
  const products = ["CC(=O)O", "CC=O", "CCO", "C=C", "CC"];
  return {
    route_id, target_smiles: products[0], engine: "askcos_retro_star",
    steps: products.slice(0, 4).map((product, index) => ({
      step_id: `s${index + 1}`, product, precursors: [products[index + 1]],
    })),
    metadata: {
      automated_review: {
        version: 1,
        forward: { matched_steps: 4, total_steps: 4, records: [{
          step_id: "s1", record_id: "a".repeat(32), expected_rank: 1,
          model: "graph2smiles_uspto_stereo", feasibility_score: 0.9,
        }] },
        references: {
          reaction_matched_steps: 1, product_matched_steps: 2, unmatched_steps: 1,
          records: [{ step_id: "s1", reaction_count: 2, product_count: 0, refs: [{
            id: "ord-contract", url: "https://example.org/reaction",
            match_scope: "reaction_identity", source: "ORD",
          }] }],
        },
      },
    },
  };
}
const legacy = () => ({ ...candidate("legacy"), metadata: {
  forward_validation_passed: true, forward_validation_method: "native_template_reconstruction",
} });
const stubs = {
  VIcon: { props: ["icon"], template: '<span :data-icon="icon" />' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VCheckboxBtn: true,
  VTooltip: { template: '<div><slot name="activator" :props="{}" /></div>' },
  VMenu: { template: '<div><slot name="activator" :props="{}" /><slot /></div>' },
  VList: true, VListItem: true,
  VProgressCircular: true,
};
const wrappers = [];
const setup = (component, props) => {
  const wrapper = mount(component, { props, global: { stubs } });
  wrappers.push(wrapper);
  return wrapper;
};
const textOf = (wrapper, section) => wrapper.get(`[data-review="${section}"]`).text().replace(/\s+/g, " ");
const originalRandomUUID = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
const originalStructuredClone = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
beforeAll(() => {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true, value: () => "review-summary-reader",
  });
  // jsdom lacks the browser clone API used by Dagre; use Node's real implementation.
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true, value: runInThisContext("structuredClone"),
  });
});
afterAll(() => {
  if (originalRandomUUID) Object.defineProperty(crypto, "randomUUID", originalRandomUUID);
  else delete crypto.randomUUID;
  if (originalStructuredClone) Object.defineProperty(globalThis, "structuredClone", originalStructuredClone);
  else delete globalThis.structuredClone;
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("the compact summary separates prediction and reference coverage without yields", () => {
  const value = candidate();
  const before = JSON.stringify(value);
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "forward")).toContain("4/4 步核验匹配");
  expect(textOf(wrapper, "references")).toContain("同反应 1 步 · 同产物资料 2 步 · 检索未匹配 1 步");
  expect(wrapper.text()).toContain("模型预测不等于实测");
  expect(wrapper.text()).toContain("同产物资料不证明同反应");
  expect(wrapper.text()).not.toMatch(/成功率|已实测|核验通过|90%|0\.9/);
  expect(wrapper.find("button, a, .v-card").exists()).toBe(false);
  expect(wrapper.emitted()).toEqual({});
  expect(JSON.stringify(value)).toBe(before);
});

test("truncation and unavailable sources remain visible without claiming absent literature", () => {
  const value = candidate();
  Object.assign(value.metadata.automated_review.references, {
    reaction_matched_steps: 1, product_matched_steps: 0, unmatched_steps: 0,
    unchecked_steps: 3, truncated_steps: 1, unavailable_source_steps: 1,
    unknown_coverage_steps: 0,
  });
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "references")).toContain("未检索 3 步");
  expect(textOf(wrapper, "coverage")).toContain("还有更多参考记录");
  expect(textOf(wrapper, "coverage")).toContain("部分资料源不可用");
});

test("old template evidence is visibly unrecorded in the automated-review summary", () => {
  const wrapper = setup(RouteReviewSummary, { candidate: legacy() });
  expect(textOf(wrapper, "forward")).toContain("未记录");
  expect(textOf(wrapper, "references")).toContain("未记录");
  expect(wrapper.text()).not.toMatch(/已核验|已验证|4\/4/);
});

test("partial and zero matches are shown literally, never as a pass", async () => {
  const value = candidate();
  value.metadata.automated_review.forward.matched_steps = 3;
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "forward")).toContain("3/4 步核验匹配");
  const zero = candidate();
  zero.metadata.automated_review.forward.matched_steps = 0;
  zero.metadata.automated_review.forward.records[0].expected_rank = null;
  await wrapper.setProps({ candidate: zero });
  expect(textOf(wrapper, "forward")).toContain("0/4 步核验匹配");
  expect(wrapper.text()).not.toMatch(/通过|成功率/);
});

test("product-only reference coverage is not displayed as matching reactions", () => {
  const value = candidate();
  const refs = value.metadata.automated_review.references;
  refs.reaction_matched_steps = 0;
  refs.product_matched_steps = 3;
  refs.records[0].reaction_count = 0;
  refs.records[0].product_count = 2;
  refs.records[0].refs[0].match_scope = "product_identity";
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "references")).toContain("同反应 0 步 · 同产物资料 3 步 · 检索未匹配 1 步");
});

test("overlapping reference scopes are separate counters, not a summed coverage rate", () => {
  const value = candidate();
  const refs = value.metadata.automated_review.references;
  refs.product_matched_steps = 3;
  refs.records[0].product_count = 1;
  refs.records[0].refs.push({
    id: "product", match_scope: "product_identity", source: "ORD",
  });
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "references")).toContain("同反应 1 步 · 同产物资料 3 步 · 检索未匹配 1 步");
  expect(wrapper.text()).not.toMatch(/记录格式无效|5\/4|覆盖率|仅同产物/);
});

test("unsupported and malformed records do not become verified after reactive updates", async () => {
  const wrapper = setup(RouteReviewSummary, { candidate: candidate() });
  const future = candidate();
  future.metadata.automated_review.version = 2;
  await wrapper.setProps({ candidate: future });
  expect(textOf(wrapper, "forward")).toContain("记录版本不支持");
  const invalid = candidate();
  invalid.metadata.automated_review.forward.matched_steps = 8;
  await wrapper.setProps({ candidate: invalid });
  expect(textOf(wrapper, "forward")).toContain("记录格式无效");
  expect(textOf(wrapper, "references")).toContain("同反应 1 步");
  await wrapper.setProps({ candidate: legacy() });
  expect(wrapper.text()).not.toContain("4/4");
  expect(textOf(wrapper, "references")).toContain("未记录");
});

test("routes without reactions are not labelled as fully verified", () => {
  const value = candidate();
  value.steps = [];
  value.metadata.automated_review.forward = { matched_steps: 0, total_steps: 0, records: [] };
  value.metadata.automated_review.references = {
    reaction_matched_steps: 0, product_matched_steps: 0, unmatched_steps: 0, records: [],
  };
  const wrapper = setup(RouteReviewSummary, { candidate: value });
  expect(textOf(wrapper, "forward")).toContain("无反应步骤");
  expect(textOf(wrapper, "references")).toContain("无反应步骤");
  expect(wrapper.text()).not.toMatch(/0\/0|通过|已核验/);
});

test("RouteReader displays one read-only summary per listed route and the selected detail", async () => {
  const value = candidate();
  const wrapper = setup(RouteReader, { candidates: [value, legacy()], canEdit: true });
  const summaries = wrapper.findAllComponents(RouteReviewSummary);
  expect(summaries).toHaveLength(2);
  expect(textOf(summaries[0], "forward")).toContain("4/4");
  expect(textOf(summaries[1], "forward")).toContain("未记录");
  wrapper.findAllComponents({ name: "RouteStepList" })[0].vm.$emit("choose", "reviewed");
  await wrapper.vm.$nextTick();
  expect(wrapper.findAllComponents(RouteReviewSummary)).toHaveLength(1);
  expect(wrapper.findComponent(RouteReviewSummary).props("candidate")).toEqual(value);
  await wrapper.findAll('[role="tab"]')[1].trigger("click");
  expect(textOf(wrapper, "forward")).toContain("未记录");
  expect(wrapper.text()).not.toContain("4/4");
  await wrapper.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  expect(wrapper.findAllComponents(RouteReviewSummary)).toHaveLength(2);
});

test("RouteReader keeps graph selection, view switching, materials and edit actions", async () => {
  const value = candidate();
  const wrapper = setup(RouteReader, {
    candidates: [value], canEdit: true, view: "graph", stockSnapshot: "b".repeat(64),
  });
  const graph = wrapper.findComponent({ name: "RouteGraph" });
  expect(graph.props("editable")).toBe(false);
  expect(graph.props("reading")).toBe(true);
  graph.vm.$emit("select", "r-1");
  await wrapper.vm.$nextTick();
  expect(wrapper.findComponent({ name: "RouteInspector" }).props("step")).toEqual(value.steps[0]);
  await wrapper.get('[aria-label="步骤"]').trigger("click");
  expect(wrapper.findComponent({ name: "RouteStepList" }).props("candidate")).toEqual(value);
  await wrapper.get('[aria-label="反应条件"]').trigger("click");
  expect(wrapper.findComponent({ name: "RouteConditions" }).props("candidate")).toEqual(value);
  await wrapper.get('[aria-label="物料清单"]').trigger("click");
  expect(wrapper.findComponent({ name: "RouteMaterials" }).props("expectedSnapshot")).toBe("b".repeat(64));
  expect(wrapper.findComponent({ name: "RouteMaterials" }).props("graph").nodes.length).toBeGreaterThan(0);
  expect(textOf(wrapper, "forward")).toContain("4/4");
  await wrapper.findAll("button").find((button) => button.text() === "编辑副本").trigger("click");
  expect(wrapper.emitted("edit")).toEqual([[value.route_id]]);
});

test("an empty RouteReader does not invent a review", () => {
  const wrapper = setup(RouteReader, { candidates: [] });
  expect(wrapper.findComponent(RouteReviewSummary).exists()).toBe(false);
  expect(wrapper.text()).toContain("暂无路线数据");
});

test("the new summary compiles script, template and scoped CSS with the real Vue compiler", () => {
  const filename = resolve(__dirname, "RouteReviewSummary.vue");
  const { descriptor, errors } = parse(readFileSync(filename, "utf8"), { filename });
  expect(errors).toEqual([]);
  const id = "route-review-summary";
  const script = compileScript(descriptor, { id });
  expect(compileTemplate({
    filename, id, source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  }).errors).toEqual([]);
  expect(compileStyle({
    filename, id, source: descriptor.styles[0].content, scoped: true,
  }).errors).toEqual([]);
});
