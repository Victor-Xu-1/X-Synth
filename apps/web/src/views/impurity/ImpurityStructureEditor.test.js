import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { waitForKetcher } from "@/common/ketcher";
import ImpurityStructureEditor from "./ImpurityStructureEditor.vue";
jest.mock("@/common/ketcher", () => ({ waitForKetcher: jest.fn() }));
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ template: "<div />" }));
const wrappers = [];
function setup() {
  let change;
  const native = { getKet: jest.fn().mockResolvedValue('{"root":{"nodes":["baseline"]}}'), editor: { subscribe: jest.fn((_, callback) => { change = callback; }), unsubscribe: jest.fn() } };
  waitForKetcher.mockResolvedValue(native);
  const editor = defineComponent({ setup(_, { expose }) {
    const pending = ref(true);
    expose({ pending, setSmilesToEditor: jest.fn().mockResolvedValue(true), readSmilesFromEditor: jest.fn().mockResolvedValue("CCO") });
  }, template: '<iframe />' });
  const wrapper = mount(ImpurityStructureEditor, { props: { modelValue: "CCO", label: "反应物 1" },
    global: { stubs: { InlineKetcherEditor: editor, MoleculeFileControls: true } } });
  wrappers.push(wrapper);
  return { wrapper, native, editor: () => wrapper.getComponent(editor), change: () => change() };
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("native writer events do not dirty an already applied material, but real canvas edits do", async () => {
  const state = setup(); await flushPromises();
  state.change();
  expect(state.wrapper.emitted("dirty")).toBeUndefined();
  state.editor().vm.$.exposed.pending.value = false;
  await state.change();
  expect(state.wrapper.emitted("dirty")).toEqual([[true], [false]]);
  state.native.getKet.mockResolvedValue('{"root":{"nodes":["edited"]}}');
  await state.change();
  expect(state.wrapper.emitted("dirty")).toEqual([[true], [false], [true], [true]]);
  state.wrapper.unmount();
  expect(state.native.editor.unsubscribe).toHaveBeenCalledWith("change", expect.any(Function));
});

test("typing remains dirty during native synchronization and is never silently ignored", async () => {
  const state = setup(); await flushPromises();
  await state.wrapper.get("input").setValue("CCN");
  expect(state.wrapper.emitted("dirty")).toEqual([[true]]);
});

test("a late unchanged document cannot clear a newer typed edit", async () => {
  const state = setup(); await flushPromises();
  state.editor().vm.$.exposed.pending.value = false;
  let finish;
  state.native.getKet.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const checking = state.change();
  await state.wrapper.get("input").setValue("CCN");
  finish('{"root":{"nodes":["baseline"]}}'); await checking;
  expect(state.wrapper.emitted("dirty")).toEqual([[true], [true]]);
});

test("a document export failure stays dirty and visibly blocks inference", async () => {
  const state = setup(); await flushPromises();
  state.editor().vm.$.exposed.pending.value = false;
  state.native.getKet.mockRejectedValueOnce(new Error("native export failed"));
  await state.change();
  expect(state.wrapper.emitted("dirty")).toEqual([[true]]);
  expect(state.wrapper.get('[role="alert"]').text()).toContain("核对失败");
  expect(state.wrapper.vm.$.exposed.pending.value).toBe(true);
});
