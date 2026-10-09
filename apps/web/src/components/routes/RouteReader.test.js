import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import dagre from "@dagrejs/dagre";
import { API } from "@/common/api";
import { oneStepCandidate } from "@/common/workbench-model";
import { originalRouteIndex, stepDetails } from "@/common/route-details";
import { routeLabel } from "@/common/route-reading";
import { initializeLocale, setLocale } from "@/i18n";
import RouteReader from "./RouteReader.vue";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";

Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = (value) => deserialize(serialize(value));

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const mockFocus = jest.fn();
jest.mock("./RouteGraph.vue", () => ({
  name: "RouteGraph",
  props: ["graph", "scores", "overview", "editable"],
  emits: ["select"],
  methods: { fit() {}, focus: (...args) => mockFocus(...args) },
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
const wrappers = [], scrollFrames = [];
function scrollFrame(className = "workspace-page") {
  const frame = document.createElement("main");
  frame.className = className;
  frame.style.overflowY = "auto";
  document.body.appendChild(frame);
  scrollFrames.push(frame);
  return frame;
}
let layout;
async function setup(candidates, props = {}, lazyVisible = true, attached = false) {
  const wrapper = mount(RouteReader, {
    props: { candidates, canEdit: true, ...props },
    attachTo: attached === true ? document.body : attached || undefined,
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
  scrollFrames.splice(0).forEach((frame) => frame.remove());
  layout.mockRestore();
});

test("step location uses the mounted graph's single viewport authority without modifying route geometry", async () => {
  const route = candidate("location-contract");
  const wrapper = await setup([route], { view: "steps", selectedRoute: route.route_id });
  const before = JSON.stringify(route);
  await wrapper.get('button[aria-label="定位步骤 1"]').trigger("click");
  await flushPromises();
  expect(mockFocus).toHaveBeenCalledWith(["r-1"], { padding: 0.45, maxZoom: 1, duration: 150 });
  expect(JSON.stringify(route)).toBe(before);
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

test("offscreen route controls stay keyboard accessible while heavy chemistry layout waits", async () => {
  const first = candidate("native-a"),
    second = candidate("native-b", "CCN");
  const wrapper = await setup([first, second], {}, false);
  expect(wrapper.findAll(".reader-overview-entry")).toHaveLength(2);
  expect(wrapper.findAll(".overview-open")).toHaveLength(2);
  expect(wrapper.findAll(".route-choice-check")).toHaveLength(2);
  expect(wrapper.findAllComponents({ name: "RouteReviewSummary" })).toHaveLength(2);
  expect(wrapper.findAllComponents({ name: "RouteGraph" })).toHaveLength(0);
  expect(layout).not.toHaveBeenCalled();
  await wrapper.setProps({ selectedRoute: second.route_id, view: "graph" });
  await flushPromises();
  expect(layout).toHaveBeenCalledTimes(1);
  await wrapper.setProps({ busy: true });
  expect(layout).toHaveBeenCalledTimes(1);
});

test("route and view tabs support roving focus, arrows and boundary keys", async () => {
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], { view: "graph" });
  const tabs = wrapper.findAll('.reader-route-tabs [role="tab"]');
  const focus = jest.spyOn(tabs[1].element, "focus");
  expect(tabs.map((tab) => tab.attributes("tabindex"))).toEqual(["0", "-1"]);
  await tabs[0].trigger("keydown", { key: "ArrowRight" });
  expect(tabs[1].attributes("aria-selected")).toBe("true");
  expect(focus).toHaveBeenCalled();
  await tabs[1].trigger("keydown", { key: "ArrowRight" });
  expect(tabs[0].attributes("aria-selected")).toBe("true");
  await tabs[0].trigger("keydown", { key: "End" });
  expect(tabs[1].attributes("tabindex")).toBe("0");
  await tabs[1].trigger("keydown", { key: "Home" });
  expect(tabs[0].attributes("aria-selected")).toBe("true");

  const views = wrapper.findAll('.reader-tool-rail [role="tab"]');
  await views[0].trigger("keydown", { key: "ArrowRight" });
  expect(views[1].attributes("aria-selected")).toBe("true");
  expect(wrapper.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe(views[1].attributes("id"));
  expect(wrapper.findComponent({ name: "RouteStepList" }).exists()).toBe(true);
  await views[1].trigger("keydown", { key: "End" });
  expect(views[3].attributes("aria-selected")).toBe("true");
  await views[3].trigger("keydown", { key: "Home", ctrlKey: true });
  expect(views[3].attributes("aria-selected")).toBe("true");
  await views[3].trigger("keydown", { key: "Home" });
  expect(views[0].attributes("aria-selected")).toBe("true");
});

test("picked routes retain their native labels and exclude unpicked route tabs", async () => {
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN"), candidate("native-c", "CCCl")]);
  wrapper.vm.pick("native-b", true);
  wrapper.vm.pick("native-c", true);
  await flushPromises();
  expect(wrapper.findAll(".reader-overview-entry.picked")).toHaveLength(2);
  await wrapper.findAll("button").find((button) => button.text() === "查看选中路线").trigger("click");
  const tabs = wrapper.findAll('.reader-route-tabs [role="tab"]');
  expect(tabs.map((tab) => tab.text())).toEqual([routeLabel(1), routeLabel(2)]);
  expect(wrapper.get('[role="tabpanel"]').attributes("id")).toBe(tabs[0].attributes("aria-controls"));
  expect(wrapper.getComponent({ name: "RouteGraph" }).props("scores")).toEqual({ "r-1": 0 });
});

test("busy overview cards cannot navigate while an edit is in progress", async () => {
  const wrapper = await setup([candidate("native-a")], { busy: true });
  const overview = wrapper.getComponent({ name: "RouteStepList" });
  expect(overview.get(".overview-open").attributes("disabled")).toBeDefined();
  overview.vm.$emit("choose", "native-a");
  await flushPromises();
  expect(wrapper.find(".reader-detail-body").exists()).toBe(false);
});

test("narrow-screen node details reveal immediately and closing returns focus to the actual step", async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  const width = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const scroll = jest.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  try {
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, true);
    const button = wrapper.get('.step-select[data-node-id="r-1"]');
    button.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    const inspector = wrapper.getComponent({ name: "RouteInspector" });
    expect(inspector.element).toBe(document.activeElement);
    expect(scroll.mock.contexts).toContain(inspector.element);
    inspector.vm.$emit("close");
    await flushPromises();
    expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(false);
    expect(document.activeElement).toBe(button.element);
    expect(scroll.mock.contexts).toContain(button.element);
  } finally {
    Object.defineProperty(window, "innerWidth", width);
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
    else delete HTMLElement.prototype.scrollIntoView;
  }
});

describe("inspector activation focus", () => {
  let originalWidth, originalScroll, scroll;
  beforeEach(() => {
    originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    scroll = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", originalWidth);
    if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
    else delete HTMLElement.prototype.scrollIntoView;
  });

  test.each([".step-select", ".step-product", ".step-precursors .step-molecule"])(
    "desktop keyboard activation of %s reveals details and normal close restores its exact origin", async (selector) => {
      const route = candidate("native-a"), before = JSON.stringify(route);
      const wrapper = await setup([route], { view: "steps" }, true, true);
      const origin = wrapper.get(selector);
      origin.element.focus();
      origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      await flushPromises();
      const inspector = wrapper.getComponent({ name: "RouteInspector" });
      expect(document.activeElement === inspector.element).toBe(true);
      expect(scroll.mock.contexts).toContain(inspector.element);
      inspector.vm.$emit("close");
      await flushPromises();
      expect(document.activeElement).toBe(origin.element);
      expect(scroll.mock.contexts).toContain(origin.element);
      expect(mockFocus).not.toHaveBeenCalled();
      expect(JSON.stringify(route)).toBe(before);
    },
  );

  test("desktop pointer inspection preserves reading focus and graph pan", async () => {
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, true);
    const origin = wrapper.get(".step-select");
    origin.element.focus();
    origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await flushPromises();
    const inspector = wrapper.getComponent({ name: "RouteInspector" });
    expect(document.activeElement).toBe(origin.element);
    expect(scroll).not.toHaveBeenCalled();
    expect(mockFocus).not.toHaveBeenCalled();
    inspector.vm.$emit("close");
    await flushPromises();
    expect(document.activeElement).toBe(origin.element);
    expect(scroll).not.toHaveBeenCalled();
  });

  test("graph keyboard activation retains the native entry and does not confuse the event with revealDetails", async () => {
    const wrapper = await setup([candidate("native-a")], { view: "graph" }, true, true);
    const flow = wrapper.getComponent({ name: "RouteGraph" });
    const button = document.createElement("button"), icon = document.createElement("span");
    button.append(icon); flow.element.append(button);
    flow.element.addEventListener("click", event => flow.vm.$emit("select", "r-1", event));
    button.focus(); icon.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await flushPromises();
    const inspector = wrapper.getComponent({ name: "RouteInspector" });
    expect(document.activeElement).toBe(inspector.element);
    inspector.vm.$emit("close"); await flushPromises();
    expect(document.activeElement).toBe(button);
  });

  test.each([390, 1440])("Locate at %ipx changes only the graph viewport, not DOM focus", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const frame = scrollFrame(), outside = document.createElement("button");
    frame.appendChild(outside);
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, frame);
    outside.focus();
    await wrapper.vm.locateNode("r-1", false);
    await flushPromises();
    expect(mockFocus).toHaveBeenCalledWith(["r-1"], { padding: 0.45, maxZoom: 1, duration: 150 });
    expect(document.activeElement).toBe(outside);
    expect(scroll).not.toHaveBeenCalled();
  });

  test("selectNode's false reveal argument also suppresses zero-detail keyboard focus", async () => {
    const frame = scrollFrame(), outside = document.createElement("button");
    frame.appendChild(outside);
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, frame);
    outside.focus();
    await wrapper.vm.selectNode("r-1", false, new MouseEvent("click", { detail: 0 }));
    await flushPromises();
    expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(scroll).not.toHaveBeenCalled();
  });

  test.each(["view", "source"])("a %s change retires a pending Locate without panning a stale graph", async (change) => {
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, true);
    const pending = wrapper.vm.locateNode("r-1", false);
    const update = wrapper.setProps(change === "view"
      ? { view: "materials" }
      : { candidates: [candidate("native-a", "CN")] });
    await Promise.all([pending, update]);
    await flushPromises();
    expect(mockFocus).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  test.each(["selection", "route", "view", "source", "unmount"])(
    "%s changes retire a pending keyboard inspector handoff", async (change) => {
      const frame = scrollFrame(), outside = document.createElement("button");
      frame.appendChild(outside);
      const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], { view: "steps" }, true, frame);
      const origin = wrapper.get(".step-select");
      origin.element.focus();
      origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
      let update;
      if (change === "selection") origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      if (change === "route") update = wrapper.setProps({ selectedRoute: "native-b" });
      if (change === "view") update = wrapper.setProps({ view: "graph" });
      if (change === "source") update = wrapper.setProps({ candidates: [candidate("native-a", "CN"), candidate("native-b", "CCN")] });
      if (change === "unmount") wrapper.unmount();
      outside.focus();
      await update;
      await flushPromises();
      expect(document.activeElement).toBe(outside);
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  test("a new same-node pointer selection cannot receive an older close's return focus", async () => {
    const frame = scrollFrame(), outside = document.createElement("button");
    frame.appendChild(outside);
    const wrapper = await setup([candidate("native-a")], { view: "steps" }, true, frame);
    const origin = wrapper.get(".step-select");
    origin.element.focus();
    origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await flushPromises();
    wrapper.getComponent({ name: "RouteInspector" }).vm.$emit("close");
    origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    outside.focus();
    scroll.mockClear();
    await flushPromises();
    expect(wrapper.findComponent({ name: "RouteInspector" }).exists()).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(scroll).not.toHaveBeenCalled();
  });

  test.each(["route", "view", "source", "unmount"])("a %s change retires pending close restoration", async (change) => {
    const frame = scrollFrame(), outside = document.createElement("button");
    frame.appendChild(outside);
    const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], { view: "steps" }, true, frame);
    const origin = wrapper.get(".step-select");
    origin.element.focus();
    origin.element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    await flushPromises();
    wrapper.getComponent({ name: "RouteInspector" }).vm.$emit("close");
    scroll.mockClear();
    let update;
    if (change === "route") update = wrapper.setProps({ selectedRoute: "native-b" });
    if (change === "view") update = wrapper.setProps({ view: "graph" });
    if (change === "source") update = wrapper.setProps({ candidates: [candidate("native-a", "CN"), candidate("native-b", "CCN")] });
    if (change === "unmount") wrapper.unmount();
    outside.focus();
    await update;
    await flushPromises();
    expect(document.activeElement).toBe(outside);
    expect(scroll).not.toHaveBeenCalled();
  });
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

test.each(["workspace-page", "preview-scroll"])("explicit lower-route entry reveals navigation and returns its exact origin in %s", async (className) => {
  const frame = scrollFrame(className);
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], {}, false, frame);
  frame.scrollTop = 1093;
  const origin = wrapper.findAll('[aria-label="查看完整路线"]')[1];
  origin.element.focus();
  await origin.trigger("click");
  await flushPromises();
  const selected = wrapper.get('.reader-route-tabs [aria-selected="true"]');
  expect(selected.text()).toBe("R002");
  expect(document.activeElement).toBe(selected.element);
  expect(frame.scrollTop).toBe(0);
  await wrapper.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  await flushPromises();
  const restored = wrapper.findAll('[aria-label="查看完整路线"]')[1];
  expect(document.activeElement).toBe(restored.element);
  expect(frame.scrollTop).toBe(1093);
  expect(layout).toHaveBeenCalledTimes(1);
});

test("multi-route reading restores its selection action and retained picks without a new route store", async () => {
  const frame = scrollFrame();
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN"), candidate("native-c", "CCCl")], {}, false, frame);
  wrapper.vm.pick("native-b", true);
  wrapper.vm.pick("native-c", true);
  await flushPromises();
  frame.scrollTop = 73;
  const origin = wrapper.findAll("button").find((button) => button.text() === "查看选中路线");
  origin.element.focus();
  await origin.trigger("click");
  await flushPromises();
  expect(wrapper.findAll('.reader-route-tabs [role="tab"]').map((tab) => tab.text())).toEqual(["R002", "R003"]);
  expect(document.activeElement).toBe(wrapper.get('.reader-route-tabs [aria-selected="true"]').element);
  expect(frame.scrollTop).toBe(0);
  await wrapper.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  await flushPromises();
  expect(document.activeElement.textContent).toBe("查看选中路线");
  expect(frame.scrollTop).toBe(73);
  expect(wrapper.findAll(".reader-overview-entry.picked")).toHaveLength(2);
});

test.each(["open", "open-graph"])("language changes retain route IDs, picks, geometry and exact %s return focus", async (action) => {
  initializeLocale(null);
  const frame = scrollFrame();
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], {}, false, frame);
  wrapper.vm.pick("native-b", true);
  await flushPromises();
  frame.scrollTop = 93;
  const origin = wrapper.findAll(`[data-reader-action="${action}"]`)[1];
  origin.element.focus();
  await origin.trigger("click");
  await flushPromises();
  const selected = wrapper.get('.reader-route-tabs [aria-selected="true"]');
  const graph = wrapper.getComponent({ name: "RouteGraph" }).props("graph");
  expect(selected.text()).toBe("R002");
  expect(document.activeElement).toBe(selected.element);
  expect(wrapper.text()).toContain("Total steps 1");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(wrapper.getComponent({ name: "RouteGraph" }).props("graph")).toBe(graph);
  expect(wrapper.get('.reader-route-tabs [aria-selected="true"]').element).toBe(selected.element);
  expect(wrapper.text()).toContain("总步数 1");
  await wrapper.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.findAll(`[data-reader-action="${action}"]`)[1].element);
  expect(frame.scrollTop).toBe(93);
  expect(wrapper.findAll(".reader-overview-entry.picked")).toHaveLength(1);
  expect(layout).toHaveBeenCalledTimes(1);
});

test.each(["route", "selection"])("parent-bound %s entry focuses the requested route after the model update", async (entry) => {
  const frame = scrollFrame();
  const parent = mount({
    components: { RouteReader },
    setup: () => ({ candidates: [candidate("native-a"), candidate("native-b", "CCN")], selected: ref("native-a"), view: ref("overview") }),
    template: '<RouteReader :candidates="candidates" v-model:selected-route="selected" v-model:view="view" />',
  }, { attachTo: frame, global: { stubs } });
  wrappers.push(parent);
  await flushPromises();
  const reader = parent.getComponent(RouteReader);
  const origin = entry === "route" ? reader.findAll(".overview-open")[1] : reader.get(".reader-selection-open");
  if (entry === "selection") reader.vm.pick("native-b", true);
  await flushPromises();
  frame.scrollTop = 1093;
  origin.element.focus();
  await origin.trigger("click");
  await flushPromises();
  const selected = reader.get('.reader-route-tabs [aria-selected="true"]');
  expect(selected.text()).toBe("R002");
  expect(document.activeElement).toBe(selected.element);
  expect(frame.scrollTop).toBe(0);
  await reader.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(reader.get(entry === "route" ? '[aria-label="查看R002完整路线"]' : ".reader-selection-open").element);
  expect(frame.scrollTop).toBe(1093);
});

test("passive source, route and view updates do not move the user's focus or scroll", async () => {
  const frame = scrollFrame();
  const outside = document.createElement("button");
  frame.appendChild(outside);
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], {}, false, frame);
  outside.focus();
  frame.scrollTop = 234;
  await wrapper.setProps({ view: "graph", selectedRoute: "native-b" });
  await wrapper.setProps({ candidates: [candidate("native-a"), candidate("native-b", "CN")] });
  await flushPromises();
  expect(document.activeElement).toBe(outside);
  expect(frame.scrollTop).toBe(234);
});

test("unmount before a requested reading layer settles cannot focus a detached route tab", async () => {
  const frame = scrollFrame();
  const wrapper = await setup([candidate("native-a")], {}, false, frame);
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  wrapper.vm.openRoute("native-a");
  wrapper.unmount();
  await flushPromises();
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
});

test("a replacement source invalidates a pending entry focus before the new layer settles", async () => {
  const frame = scrollFrame();
  const outside = document.createElement("button");
  frame.appendChild(outside);
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")], {}, false, frame);
  const pending = wrapper.vm.openRoute("native-b");
  const update = wrapper.setProps({ candidates: [candidate("native-a"), candidate("native-b", "CN")] });
  outside.focus();
  frame.scrollTop = 345;
  await Promise.all([pending, update]);
  await flushPromises();
  expect(document.activeElement).toBe(outside);
  expect(frame.scrollTop).toBe(345);
});

test("returning from a direct reading view reveals the selected route even without an earlier overview origin", async () => {
  const frame = scrollFrame();
  const wrapper = await setup([candidate("native-a"), candidate("native-b", "CCN")],
    { view: "graph", selectedRoute: "native-b" }, false, frame);
  await wrapper.findAll("button").find((button) => button.text() === "全部路线").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.findAll(".overview-open")[1].element);
});
