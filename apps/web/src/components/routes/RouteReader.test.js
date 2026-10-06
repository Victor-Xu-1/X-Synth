import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import dagre from "@dagrejs/dagre";
import { API } from "@/common/api";
import { oneStepCandidate } from "@/common/workbench-model";
import { originalRouteIndex, stepDetails } from "@/common/route-details";
import RouteReader from "./RouteReader.vue";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";

Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = (value) => deserialize(serialize(value));

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@vue-flow/core", () => ({
  useVueFlow: () => ({ fitView: jest.fn() }),
}));
jest.mock("./RouteGraph.vue", () => ({
  name: "RouteGraph",
  props: ["graph", "scores", "overview", "editable"],
  emits: ["select"],
  methods: { fit() {} },
  template: '<div class="graph-contract" />',
}));
jest.mock("./RouteInspector.vue", () => ({
  name: "RouteInspector",
  template: "<div />",
}));
jest.mock("./RouteConditions.vue", () => ({
  name: "RouteConditions",
  template: "<div />",
}));
jest.mock("./RouteMaterials.vue", () => ({
  name: "RouteMaterials",
  template: "<div />",
}));
jest.mock("@/components/SmilesImage.vue", () => ({
  name: "SmilesImage",
  props: ["smiles"],
  template: '<div class="structure-contract" />',
}));

const stubs = {
  VBtn: {
    props: ["disabled"],
    template: '<button :disabled="disabled"><slot /></button>',
  },
  VTooltip: {
    template: '<div><slot name="activator" :props="{}" /></div>',
  },
  VMenu: {
    template: '<div><slot name="activator" :props="{}" /><slot /></div>',
  },
  VList: { template: '<div><slot /></div>' },
  VListItem: true,
  VIcon: true,
  VProgressCircular: true,
  VCheckboxBtn: true,
  VLazy: { template: '<div><slot /></div>' },
  RouteFilters: {
    name: "RouteFilters",
    props: ["modelValue", "candidates"],
    emits: ["update:modelValue"],
    template: '<div />',
  },
  RouteReviewSummary: true,
  RouteConditions: true,
  RouteMaterials: true,
  RouteInspector: true,
  RouteEvidencePanel: true,
};
const wrappers = [];
let layout;
async function setup(candidates, props = {}, lazyVisible = true) {
  const wrapper = mount(RouteReader, {
    props: { candidates, canEdit: true, ...props },
    global: {
      stubs: {
        ...stubs,
        VLazy: lazyVisible ? stubs.VLazy : { template: "<div />" },
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}
const candidate = (id, target = "CCO") => ({
  route_id: id,
  engine: "askcos_mcts",
  target_smiles: target,
  closed: false,
  starting_materials: ["CC=O", "[H][H]"],
  steps: [
    { product: target, precursors: ["CC=O", "[H][H]"], confidence: 0 },
  ],
});
beforeEach(() => {
  jest.clearAllMocks();
  API.post.mockRejectedValue(new Error("catalog unavailable"));
  layout = jest.spyOn(dagre, "layout");
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  layout.mockRestore();
});

test("the actual one-step adapter selects and displays an unclosed preview with all native chemistry", async () => {
  const item = {
    outcome: "[13CH3][C@@H](N)CO.[Cl-]",
    plausibility: 0,
    model_metadata: [{ source: { template: { _id: "native", index: 17 } } }],
  };
  const route = oneStepCandidate(
    {
      canonical: "[13CH3][C@H]([NH3+])CO.[Cl-]",
      model: "pistachio",
      outcomes: [item],
    },
    0,
  );
  const wrapper = await setup([route], { view: "graph" });
  const flow = wrapper.getComponent({ name: "RouteGraph" });
  expect(wrapper.emitted("update:selectedRoute")[0]).toEqual([
    route.route_id,
  ]);
  expect(wrapper.text()).toContain("总步数 1");
  expect(wrapper.text()).toContain("最长线性步数 1");
  expect(wrapper.text()).toContain("未闭合");
  expect(wrapper.text()).not.toContain("没有符合筛选的路线");
  expect(flow.props("editable")).toBe(false);
  expect(flow.props("scores")).toEqual({ "r-1": 0 });
  expect(
    flow.props("graph").nodes
      .filter((node) => node.type === "molecule")
      .map((node) => node.smiles),
  ).toEqual([route.target_smiles, "[13CH3][C@@H](N)CO", "[Cl-]"]);
  await wrapper.findAll("button")
    .find((button) => button.text() === "编辑副本")
    .trigger("click");
  expect(wrapper.emitted("edit")).toEqual([[route.route_id]]);
  expect(originalRouteIndex([route], wrapper.emitted("edit")[0][0])).toBe(0);
  expect(stepDetails(route, flow.props("graph"))[0].record.metadata).toBe(
    item,
  );
  expect(layout).toHaveBeenCalledTimes(1);
});

test("thumbnail, detail, steps, filters and reordered candidates share each prepared layout", async () => {
  const first = candidate("native-a"),
    second = candidate("native-b", "CCN");
  const wrapper = await setup([first, second]);
  expect(layout).toHaveBeenCalledTimes(2);
  const firstGraph = wrapper
    .findAllComponents({ name: "RouteGraph" })[0]
    .props("graph");
  const stepList = wrapper.findAllComponents({ name: "RouteStepList" })[0];
  stepList.vm.$emit("choose", first.route_id);
  await flushPromises();
  expect(
    wrapper.getComponent({ name: "RouteGraph" }).props("graph").edges,
  ).toBe(firstGraph.edges);
  await wrapper.get('button[aria-label="步骤"]').trigger("click");
  expect(
    wrapper.getComponent({ name: "RouteStepList" }).props("graph"),
  ).toBe(firstGraph);
  await wrapper.findAll("button")
    .find((button) => button.text() === "全部路线")
    .trigger("click");
  const filters = wrapper.getComponent({ name: "RouteFilters" });
  filters.vm.$emit("update:modelValue", {
    query: "native-b", engine: "", closure: "", sort: "score",
  });
  await flushPromises();
  expect(
    wrapper.findAllComponents({ name: "RouteStepList" })[0]
      .props("choices")[0].originalIndex,
  ).toBe(1);
  filters.vm.$emit("update:modelValue", {
    query: "", engine: "", closure: "", sort: "rank",
  });
  await wrapper.setProps({ candidates: [second, first] });
  expect(
    wrapper.findAllComponents({ name: "RouteGraph" })[1].props("graph"),
  ).toBe(firstGraph);
  expect(layout).toHaveBeenCalledTimes(2);
});

test("offscreen thumbnails and topology summaries do not run Dagre until the route is opened", async () => {
  const first = candidate("native-a"),
    second = candidate("native-b", "CCN");
  const wrapper = await setup([first, second], {}, false);
  expect(wrapper.text()).toContain("最长线性步数");
  expect(layout).not.toHaveBeenCalled();
  wrapper.findAllComponents({ name: "RouteStepList" })[1].vm.$emit(
    "choose", second.route_id,
  );
  await flushPromises();
  expect(layout).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ busy: true });
  expect(layout).toHaveBeenCalledTimes(1);
});

test("fresh source snapshots and reactive chemistry updates cannot reuse a stale prepared graph", async () => {
  const first = reactive(candidate("native-a"));
  const wrapper = await setup([first], { view: "graph" });
  expect(layout).toHaveBeenCalledTimes(1);
  const chemistry = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  first.target_smiles = chemistry;
  first.steps[0] = {
    product: chemistry,
    precursors: ["N", "O"],
    confidence: 0.25,
  };
  await flushPromises();
  const flow = wrapper.getComponent({ name: "RouteGraph" });
  const targetSmiles = () =>
    flow.props("graph").nodes.find((node) => node.id === "m-1").smiles;
  expect(targetSmiles()).toBe(chemistry);
  expect(flow.props("scores")).toEqual({ "r-1": 0.25 });
  expect(layout).toHaveBeenCalledTimes(2);
  await wrapper.setProps({ candidates: [candidate("native-a", "CN")] });
  expect(targetSmiles()).toBe("CN");
  expect(layout).toHaveBeenCalledTimes(3);
});
