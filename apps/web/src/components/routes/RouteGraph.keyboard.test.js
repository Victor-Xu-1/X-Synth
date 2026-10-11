import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { randomUUID } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { useRouteDocument } from "@/composables/useRouteDocument";
import RouteGraph from "./RouteGraph.vue";

jest.mock("@vue-flow/core/dist/style.css", () => ({}));
jest.mock("@vueuse/core", () => ({ useResizeObserver: jest.fn() }));
jest.mock("./MoleculeNode.vue", () => ({ template: '<span>Molecule</span>' }));
jest.mock("./ReactionNode.vue", () => ({ template: '<span>Reaction</span>' }));
Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID });
globalThis.structuredClone = value => deserialize(serialize(value));

const previousResizeObserver = globalThis.ResizeObserver;
let wrapper;
let warnings;
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  warnings = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  wrapper?.unmount(); globalThis.ResizeObserver = previousResizeObserver;
  const messages = warnings.mock.calls.map(args => args.map(String).join(" "));
  warnings.mockRestore();
  // jsdom has no native canvas layout or imported CSS; all other warnings fail.
  expect(messages.filter(message => !message.includes("haven't loaded the necessary styles")
    && !message.includes("parent container needs a width and a height"))).toEqual([]);
});

async function setup(editable = true) {
  let document;
  wrapper = mount(defineComponent({ setup() {
    document = useRouteDocument();
    document.graph.value = { target_id: "m", nodes: [{ id: "m", type: "molecule", smiles: "CCO",
      label: "Original name", note: "", position: { x: 100, y: 100 } }], edges: [] };
    return () => h(RouteGraph, { id: "real-keyboard-" + editable, graph: document.graph.value, editable,
      "onUpdate:graph": document.replaceGraph });
  } }), { attachTo: window.document.body, global: { stubs: {
    VTooltip: { props: ["text"], template: '<slot name="activator" :props="{}" />' }, VBtn: { template: '<button />' },
  } } });
  await flushPromises();
  return { document, node: wrapper.get('.vue-flow__node[data-id="m"]') };
}

test("installed Vue Flow arrow and shift-arrow moves enter document undo and serialized coordinates", async () => {
  const { document, node } = await setup();
  await node.trigger('keydown', { key: 'Enter' });
  await node.trigger('keydown', { key: 'ArrowRight' }); await flushPromises();
  expect(document.graph.value.nodes[0].position).toEqual({ x: 105, y: 100 });
  expect(document.dirty.value).toBe(true); expect(document.undoStack.value).toHaveLength(1);
  await node.trigger('keydown', { key: 'ArrowRight', shiftKey: true }); await flushPromises();
  expect(document.graph.value.nodes[0].position).toEqual({ x: 125, y: 100 });
  expect(document.undoStack.value).toHaveLength(2);
  document.undo(); await flushPromises();
  expect(document.graph.value.nodes[0].position.x).toBe(105);
  document.redo(); await flushPromises();
  const saved = JSON.parse(JSON.stringify(document.graph.value));
  expect(saved.nodes[0]).toMatchObject({ position: { x: 125, y: 100 }, smiles: "CCO", label: "Original name" });
});

test("native arrow movement is disabled for read-only routes", async () => {
  const { document, node } = await setup(false);
  await node.trigger('keydown', { key: 'Enter' });
  await node.trigger('keydown', { key: 'ArrowRight' }); await flushPromises();
  expect(document.graph.value.nodes[0].position).toEqual({ x: 100, y: 100 });
  expect(document.dirty.value).toBe(false); expect(document.undoStack.value).toHaveLength(0);
});
