import { flushPromises, mount } from "@vue/test-utils";
import RouteGraph from "./RouteGraph.vue";
import { randomUUID } from "node:crypto";

Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });

jest.mock("@vue-flow/core", () => ({
  VueFlow: {
    name: "VueFlow",
    props: ["nodes", "edges", "minZoom"],
    emits: ["node-drag-stop", "connect"],
    template: "<div />",
  },
  useVueFlow: () => ({
    fitView: jest.fn(),
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  }),
  MarkerType: { ArrowClosed: "arrowclosed" },
}));
jest.mock("@vue-flow/core/dist/style.css", () => ({}));
jest.mock("./MoleculeNode.vue", () => ({ template: "<div />" }));
jest.mock("./ReactionNode.vue", () => ({ template: "<div />" }));

const wrappers = [];
function setup(graph, editable = false) {
  const wrapper = mount(RouteGraph, {
    props: { graph, editable, id: "graph-contract" },
    global: { stubs: { VBtn: true, VTooltip: true } },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

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
