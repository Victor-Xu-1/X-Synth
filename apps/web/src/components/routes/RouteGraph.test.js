import { flushPromises, mount } from "@vue/test-utils";
import RouteGraph from "./RouteGraph.vue";
import { randomUUID } from "node:crypto";
import { initializeLocale, setLocale } from "@/i18n";

Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });

const mockFitView = jest.fn();
const mockResize = jest.fn();
jest.mock("@vueuse/core", () => ({ useResizeObserver: (...args) => mockResize(...args) }));
jest.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges", "minZoom"],
    emits: ["node-drag-stop", "connect", "node-click", "nodes-initialized"],
    template: '<div><div v-for="node in nodes" :key="node.id" @click="$emit(\'node-click\', { node, event: $event })"><slot :name="\'node-\' + node.type" :data="node.data" :selected="node.selected" /></div><slot /></div>',
  },
  useVueFlow: () => ({
    fitView: mockFitView,
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  }),
  MarkerType: { ArrowClosed: "arrowclosed" },
  Handle: { template: "<span />" },
  Position: { Left: "left", Right: "right" },
}));
jest.mock("@vue-flow/core/dist/style.css", () => ({}));
jest.mock("./MoleculeNode.vue", () => ({ template: "<div />" }));
jest.mock("./ReactionNode.vue", () => jest.requireActual("./ReactionNode.vue"));

const wrappers = [];
function setup(graph, editable = false) {
  const wrapper = mount(RouteGraph, {
    props: { graph, editable, id: "graph-contract" },
    global: { stubs: {
      VBtn: { template: '<button><slot /></button>' },
      VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
      VIcon: true,
    } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
beforeEach(() => { mockFitView.mockClear(); mockResize.mockClear(); });

test("optional toolbar keeps viewport actions outside the molecule pan-and-zoom surface", async () => {
  const wrapper = setup({ target_id: "target", nodes: [{ id: "target", type: "molecule", position: { x: 20, y: 20 } }], edges: [] });
  expect(wrapper.classes()).not.toContain("toolbar");
  await wrapper.setProps({ toolbar: true });
  expect(wrapper.classes()).toContain("toolbar");
  const actions = wrapper.get(".route-viewport-controls");
  expect(wrapper.getComponent({ name: "VueFlow" }).element.contains(actions.element)).toBe(false);
  expect(actions.findAll("button")).toHaveLength(3);
  expect(wrapper.emitted("update:graph")).toBeUndefined();
});

test("initialization readiness is emitted only after the genuine viewport fit and not after release", async () => {
  const wrapper = setup({ target_id: "m", nodes: [{ id: "m", type: "molecule", position: { x: 20, y: 20 } }], edges: [] });
  const ready = jest.fn(); await wrapper.setProps({ onReady: ready });
  jest.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue({ width: 800, height: 400 });
  await flushPromises();
  let finish;
  mockFitView.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  wrapper.getComponent({ name: "VueFlow" }).vm.$emit("nodes-initialized"); await flushPromises();
  expect(wrapper.emitted("ready")).toBeUndefined();
  finish(); await flushPromises();
  expect(ready).toHaveBeenCalledTimes(1);
  mockFitView.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  wrapper.getComponent({ name: "VueFlow" }).vm.$emit("nodes-initialized"); await flushPromises();
  wrapper.unmount(); finish(); await flushPromises();
  expect(ready).toHaveBeenCalledTimes(1);
});

test("a resized or revealed canvas refits the whole graph and ignores zero-size or disposed callbacks", async () => {
  const graph = { target_id: "target", nodes: [{ id: "target", type: "molecule", position: { x: 0, y: 0 } }], edges: [] };
  const wrapper = setup(graph);
  const bounds = { width: 900, height: 360 };
  jest.spyOn(wrapper.element, "getBoundingClientRect").mockImplementation(() => bounds);
  await flushPromises();
  expect(mockResize).toHaveBeenCalledTimes(1);
  const resize = mockResize.mock.calls[0][1];
  const notify = () => resize([{ contentRect: { ...bounds } }]);
  mockFitView.mockClear();
  bounds.width = 320;
  notify(); notify();
  await flushPromises();
  expect(mockFitView).toHaveBeenCalledTimes(1);
  expect(mockFitView).toHaveBeenCalledWith({ padding: 0.12, maxZoom: 1.25, duration: 0 });
  mockFitView.mockClear();
  bounds.width = 0;
  notify();
  await flushPromises();
  expect(mockFitView).not.toHaveBeenCalled();
  bounds.width = 320;
  notify();
  await flushPromises();
  expect(mockFitView).toHaveBeenCalledTimes(1);
  mockFitView.mockClear();
  bounds.width = 700;
  notify();
  wrapper.unmount();
  await flushPromises();
  expect(mockFitView).not.toHaveBeenCalled();
  expect(wrapper.emitted("update:graph")).toBeUndefined();
});

test("a read-only replacement with the same target fits new geometry but scientific scores and language do not reset zoom", async () => {
  const graph = { target_id: "target", nodes: [{ id: "target", type: "molecule", position: { x: 0, y: 0 } }], edges: [] };
  const wrapper = setup(graph);
  jest.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue({ width: 700, height: 360 });
  await flushPromises();
  mockFitView.mockClear();
  await wrapper.setProps({ graph: { ...graph, nodes: [{ ...graph.nodes[0], position: { x: 900, y: 80 } }] } });
  await flushPromises();
  expect(mockFitView).toHaveBeenCalledTimes(1);
  mockFitView.mockClear();
  await wrapper.setProps({ scores: { target: 0 } });
  setLocale("en", { persist: false });
  await flushPromises();
  expect(mockFitView).not.toHaveBeenCalled();
  expect(wrapper.emitted("update:graph")).toBeUndefined();
});

test("editable position and note updates retain the user's viewport until explicitly arranged or fitted", async () => {
  const graph = { target_id: "target", nodes: [{ id: "target", type: "molecule", position: { x: 0, y: 0 } }], edges: [] };
  const wrapper = setup(graph, true);
  jest.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue({ width: 700, height: 360 });
  await flushPromises();
  mockFitView.mockClear();
  await wrapper.setProps({ graph: { ...graph, nodes: [{ ...graph.nodes[0], note: "原始备注", position: { x: 900, y: 80 } }] } });
  await flushPromises();
  expect(mockFitView).not.toHaveBeenCalled();
  await wrapper.vm.fit();
  expect(mockFitView).toHaveBeenCalledTimes(1);
  expect(wrapper.emitted("update:graph")).toBeUndefined();
});

test("an explicit step focus wins over a coalesced reveal and survives resize until the user fits the complete route", async () => {
  const graph = { target_id: "target", nodes: [{ id: "target", type: "molecule", position: { x: 0, y: 0 } }], edges: [] };
  const wrapper = setup(graph);
  const bounds = { width: 700, height: 360 };
  jest.spyOn(wrapper.element, "getBoundingClientRect").mockImplementation(() => bounds);
  await flushPromises();
  const resize = mockResize.mock.calls[0][1];
  mockFitView.mockClear();
  resize([{ contentRect: { ...bounds } }]);
  await wrapper.vm.focus(["target"], { padding: 0.45, maxZoom: 1, duration: 150 });
  expect(mockFitView).toHaveBeenLastCalledWith({ nodes: ["target"], padding: 0.45, maxZoom: 1, duration: 150 });
  mockFitView.mockClear();
  bounds.width = 320;
  resize([{ contentRect: { ...bounds } }]);
  await flushPromises();
  expect(mockFitView).toHaveBeenLastCalledWith({ nodes: ["target"], padding: 0.45, maxZoom: 1, duration: 0 });
  await wrapper.vm.fit();
  expect(mockFitView).toHaveBeenLastCalledWith({ padding: 0.12, maxZoom: 1.25, duration: 0 });
  expect(wrapper.emitted("update:graph")).toBeUndefined();
});

test.each(["overview", "reading", "editable"])(
  "%s can fit a wide route below the former fixed zoom floor",
  async (mode) => {
    const wrapper = setup({ target_id: "target", nodes: [], edges: [] });
    await wrapper.setProps({ [mode]: true });
    expect(wrapper.getComponent({ name: "VueFlow" }).props("minZoom")).toBe(0.01);
  },
);

test("starting-node flags scan incoming edges once and are reused when scores change", async () => {
  let targetReads = 0;
  const graph = {
    target_id: "m-40",
    nodes: Array.from({ length: 41 }, (_, index) => ({
      id: `m-${index}`,
      type: index % 2 ? "reaction" : "molecule",
      smiles: index % 2 ? "" : "CCO",
      position: { x: index * 260, y: 0 },
    })),
    edges: Array.from({ length: 40 }, (_, index) => ({
      id: `e-${index}`,
      source: `m-${index}`,
      get target() {
        targetReads++;
        return `m-${index + 1}`;
      },
    })),
  };
  const wrapper = setup(graph);
  const flow = wrapper.getComponent({ name: "VueFlow" });
  const startingIds = () =>
    flow.props("nodes")
      .filter((node) => node.data.isStarting)
      .map((node) => node.id);
  expect(startingIds()).toEqual(["m-0"]);
  expect(targetReads).toBeLessThanOrEqual(graph.edges.length * 3);
  const reads = targetReads;
  await wrapper.setProps({ scores: { "m-0": 0 } });
  expect(flow.props("nodes")[0].data.score).toBe(0);
  expect(targetReads).toBe(reads);
  await wrapper.setProps({ graph: { ...graph, edges: graph.edges.slice(1) } });
  expect(startingIds()).toEqual(["m-0", "m-1"]);
});

test("late drag or connect callbacks cannot write while graph editing is locked", async () => {
  const graph = {
    target_id: "p",
    nodes: [
      {
        id: "p",
        type: "molecule",
        smiles: "CCO",
        position: { x: 0, y: 0 },
      },
      {
        id: "a",
        type: "molecule",
        smiles: "O",
        position: { x: 100, y: 0 },
      },
      { id: "r", type: "reaction", position: { x: 200, y: 0 } },
    ],
    edges: [],
  };
  const wrapper = setup(graph);
  const flow = wrapper.getComponent({ name: "VueFlow" });
  flow.vm.$emit("node-drag-stop", {
    node: { id: "a", position: { x: 50, y: 20 } },
  });
  flow.vm.$emit("connect", { source: "a", target: "r" });
  await flushPromises();
  expect(wrapper.emitted("update:graph")).toBeUndefined();
  expect(wrapper.emitted("error")).toBeUndefined();
  await wrapper.setProps({ editable: true });
  flow.vm.$emit("connect", { source: "a", target: "r" });
  await flushPromises();
  expect(wrapper.emitted("update:graph")[0][0].edges).toEqual([
    expect.objectContaining({ source: "a", target: "r" }),
  ]);
});

test("the reaction detail button uses the existing Vue Flow selection event without rewriting geometry", async () => {
  const graph = {
    target_id: "target", edges: [],
    nodes: [{ id: "reaction", type: "reaction", label: "步骤 1", position: { x: 200, y: 80 } }],
  };
  const wrapper = setup(graph);
  await wrapper.setProps({ reading: true, scores: { reaction: 0 } });
  const event = new MouseEvent("click", { bubbles: true, detail: 0 });
  wrapper.get('button[aria-label="查看步骤 1详情"]').element.dispatchEvent(event);
  await flushPromises();
  expect(wrapper.emitted("select")[0][0]).toBe("reaction");
  expect(wrapper.emitted("select")[0][1]).toBe(event);
  expect(wrapper.emitted("update:graph")).toBeUndefined();
  expect(graph.nodes[0].position).toEqual({ x: 200, y: 80 });
  expect(wrapper.getComponent({ name: "VueFlow" }).props("nodes")[0].data.score).toBe(0);
});

test("language switches update generated captions without replacing flow nodes, geometry, scores or raw graph labels", async () => {
  initializeLocale(null);
  const graph = { target_id: "target", edges: [], nodes: [{ id: "reaction", type: "reaction", label: "步骤 1", position: { x: 200, y: 80 } }] };
  const before = JSON.stringify(graph), wrapper = setup(graph);
  await wrapper.setProps({ generatedStepLabels: true, scores: { reaction: 0 } });
  const flow = wrapper.getComponent({ name: "VueFlow" }), nodes = flow.props("nodes");
  expect(wrapper.get("strong").text()).toBe("Step 1");
  setLocale("zh-CN", { persist: false });
  await flushPromises();
  expect(flow.props("nodes")).toBe(nodes);
  expect(nodes[0].data.label).toBe("步骤 1");
  expect(nodes[0].data.score).toBe(0);
  expect(wrapper.get("strong").text()).toBe("步骤 1");
  expect(wrapper.emitted("update:graph")).toBeUndefined();
  expect(JSON.stringify(graph)).toBe(before);
});
