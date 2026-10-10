import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { useWorkspaceStore } from "@/store/workspace";
import StockSearch from "./StockSearch.vue";

let mockIntersection;
jest.mock("@vueuse/core", () => ({ useIntersectionObserver: (_root, callback) => { mockIntersection = callback; return { stop() {} }; } }));
jest.mock("vue-router", () => ({ useRoute: jest.fn(), useRouter: jest.fn(() => ({ replace: jest.fn() })) }));
jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
jest.mock("@/store/workspace", () => ({ useWorkspaceStore: jest.fn() }));
jest.mock("@/components/workspace/StructurePreview.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ name: "MoleculeFileControls", template: "<div />" }));
let wrapper, host;
const snapshot = "a".repeat(64);

// Actual input/iframe/write queue; controlled editor and observer boundaries are not native proof.
function editorFixture() {
  const eventBus = new EventEmitter();
  const fixture = {
    eventBus,
    setMolecule: jest.fn(() => queueMicrotask(() => eventBus.emit("SUCCESS"))),
    getSmiles: jest.fn(async () => "CCO"),
    editor: {
      clear: jest.fn(), zoom: () => 1,
      subscribe: jest.fn((event, handler) => {
        if (event === "change") { fixture.change = handler; return "change-token"; }
        return { handler };
      }),
      unsubscribe: jest.fn(),
    },
  };
  return fixture;
}
async function settle() {
  await jest.advanceTimersByTimeAsync(140);
  await nextTick();
  await jest.advanceTimersByTimeAsync(32);
  await nextTick();
}
beforeAll(() => {
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: randomUUID });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => {
  jest.useFakeTimers();
  API.post.mockReset();
  useRoute.mockReturnValue(reactive({ query: { smiles: "CCO", snapshot } }));
  useWorkspaceStore.mockReturnValue({ health: {} });
  host = document.createElement("div");
  document.body.appendChild(host);
  wrapper = mount(StockSearch, { attachTo: host, global: { stubs: {
    ModuleWorkbench: { template: "<section><slot /></section>" }, MoleculeFileControls: true, KetcherModal: true,
    VBtn: { template: "<button><slot /></button>" }, VIcon: true, VTooltip: true, VProgressCircular: true, VProgressLinear: true,
  } } });
});
afterEach(() => {
  wrapper?.unmount();
  host?.remove();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("recycled confirmed iframe never clears source query or its task snapshot, and reentry confirms before lookup", async () => {
  const field = wrapper.getComponent({ name: "StructureInput" });
  mockIntersection([{ isIntersecting: true }]);
  await nextTick();
  const frame = wrapper.get("iframe").element;
  const firstEditor = editorFixture();
  frame.contentWindow.ketcher = firstEditor;
  await settle();
  expect(field.vm.pending).toBe(false);
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({ snapshot, results: { CCO: [{ smiles: "CCO", catalog_id: "record-a" }] } });
  await wrapper.get("form").trigger("submit");
  await settle();
  expect(wrapper.get('[data-cy="stock-match-heading"]').isVisible()).toBe(true);
  mockIntersection([{ isIntersecting: false }]);
  await nextTick();
  expect(frame.isConnected).toBe(false);
  expect(firstEditor.editor.unsubscribe).toHaveBeenCalledWith("change", "change-token");
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  expect(wrapper.getComponent({ name: "StructureInput" }).element).toBe(field.element);
  await wrapper.get('[data-cy="stock-edit-query"]').trigger("click");
  mockIntersection([{ isIntersecting: true }]);
  await nextTick();
  const replacement = wrapper.get("iframe").element;
  expect(replacement).not.toBe(frame);
  expect(field.vm.pending).toBe(true);
  await wrapper.get("form").trigger("submit");
  expect(API.post).toHaveBeenCalledTimes(2);
  replacement.contentWindow.ketcher = editorFixture();
  await settle();
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  API.post.mockResolvedValueOnce({ smiles: "CCO" }).mockResolvedValueOnce({ snapshot, results: { CCO: [] } });
  await wrapper.get("form").trigger("submit");
  await settle();
  await wrapper.findAll('[role="tab"]').find((tab) => tab.text() === "证据详情").trigger("click");
  expect(wrapper.text()).toContain("任务快照 SHA256");
  expect(wrapper.text()).toContain("与任务快照一致");
  expect(API.post.mock.calls[2]).toEqual(["/api/v1/structure/validate", { smiles: "CCO" }]);
});

test("an unfinished native edit stays mounted offscreen and cannot submit its old source text", async () => {
  const field = wrapper.getComponent({ name: "StructureInput" });
  mockIntersection([{ isIntersecting: true }]);
  await nextTick();
  const frame = wrapper.get("iframe").element;
  const editor = editorFixture();
  frame.contentWindow.ketcher = editor;
  await settle();
  editor.change();
  await nextTick();
  expect(field.vm.pending).toBe(true);
  mockIntersection([{ isIntersecting: false }]);
  await nextTick();
  expect(frame.isConnected).toBe(true);
  expect(wrapper.get("textarea").element.value).toBe("CCO");
  await wrapper.get("form").trigger("submit");
  expect(API.post).not.toHaveBeenCalled();
});
