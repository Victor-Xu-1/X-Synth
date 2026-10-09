import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ImpurityStructureEditor from "./ImpurityStructureEditor.vue";
jest.mock("@/components/InlineKetcherEditor.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/MoleculeFileControls.vue", () => ({ template: "<div />" }));
const wrappers = [];
function setup() {
  const native = { getKet: jest.fn().mockResolvedValue('{"root":{"nodes":["baseline"]}}') };
  const editor = defineComponent({ props: { contentChanged: Function }, setup(_, { expose }) {
    const pending = ref(true);
    expose({ pending, exportKet: (...args) => native.getKet(...args), setSmilesToEditor: jest.fn().mockResolvedValue(true), readSmilesFromEditor: jest.fn().mockResolvedValue("CCO") });
  }, template: '<iframe />' });
  const wrapper = mount(ImpurityStructureEditor, { props: { modelValue: "CCO", label: "反应物 1" },
    global: { stubs: { InlineKetcherEditor: editor, MoleculeFileControls: true } } });
  wrappers.push(wrapper);
  return { wrapper, native, editor: () => wrapper.getComponent(editor), change: () => wrapper.getComponent(editor).props("contentChanged")() };
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
  const oldChange = state.editor().props("contentChanged");
  state.wrapper.unmount();
  const calls = state.native.getKet.mock.calls.length;
  await oldChange();
  expect(state.native.getKet).toHaveBeenCalledTimes(calls);
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

test("new frame documents come from the current inline owner and remain pending until it is confirmed", async () => {
  const state = setup(); await flushPromises();
  expect(state.wrapper.vm.$.exposed.pending.value).toBe(true);
  state.editor().vm.$.exposed.pending.value = false;
  const currentDocument = jest.fn().mockResolvedValue('{"root":{"nodes":["fresh drawing"]}}');
  state.editor().vm.$.exposed.exportKet = currentDocument;
  await state.change();
  expect(currentDocument).toHaveBeenCalledTimes(1);
  expect(state.wrapper.emitted("dirty")).toEqual([[true], [true]]);
});
