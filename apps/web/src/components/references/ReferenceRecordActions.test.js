import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { initializeLocale, setLocale } from "@/i18n";
import { uiStubs } from "@/views/workspace/reaction-canvas.test-support";
import ReferenceRecordActions from "./ReferenceRecordActions.vue";

const records = [
  { id: "source-A", reaction_smiles: "[13CH3][C@H](O)C>O>CC=O", products: ["CC=O", "Cl"] },
  { id: "source-B", reaction_smiles: "CCN>O>CC=N", products: ["CC=N"] },
];
const wrappers = [];
function setup(extra = {}) {
  const wrapper = mount(ReferenceRecordActions, {
    props: { record: records[0], allowCanvasReuse: true, exportable: true, ...extra },
    global: { stubs: uiStubs },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test("actions always emit the current immutable record, not the originally mounted one", async () => {
  const wrapper = setup(), before = JSON.stringify(records);
  await wrapper.setProps({ record: records[1] });
  await wrapper.get('[data-cy="reference-load-reaction"]').trigger("click");
  await wrapper.get('[data-cy="reference-copy"]').trigger("click");
  await wrapper.get('[data-cy="reference-export"]').trigger("click");
  expect(wrapper.emitted("load-reaction")).toEqual([[records[1]]]);
  expect(wrapper.emitted("operate")).toEqual([[records[1], "copy"], [records[1], "export"]]);
  expect(JSON.stringify(records)).toBe(before);
});

test("an active export marks its own record busy and blocks competing actions even without caller disabled", async () => {
  const wrapper = setup({ exporting: true });
  expect(wrapper.get('[role="group"]').attributes("aria-busy")).toBe("true");
  expect(wrapper.get('[role="group"]').attributes("data-reference-id")).toBe(records[0].id);
  for (const button of wrapper.findAll("button")) {
    expect(button.element.disabled).toBe(true);
    await button.trigger("click");
  }
  expect(wrapper.emitted("load-reaction")).toBeUndefined();
  expect(wrapper.emitted("operate")).toBeUndefined();
});

test("non-exportable records retain raw-copy access but never enable partial reuse or RXN export", async () => {
  const wrapper = setup({ exportable: false });
  expect(wrapper.get('[data-cy="reference-load-reaction"]').element.disabled).toBe(true);
  expect(wrapper.get('[data-cy="reference-export"]').element.disabled).toBe(true);
  await wrapper.get('[data-cy="reference-copy"]').trigger("click");
  expect(wrapper.emitted("operate")).toEqual([[records[0], "copy"]]);
});

test("English and Chinese labels change without replacing the current record action or touching its raw chemistry", async () => {
  initializeLocale(null);
  const wrapper = setup(), action = wrapper.get('[data-cy="reference-load-reaction"]').element;
  const before = JSON.stringify(records);
  expect(wrapper.text()).toContain("Load into drawing editor");
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(wrapper.text()).toContain("载入画板");
  expect(wrapper.get('[data-cy="reference-load-reaction"]').element).toBe(action);
  expect(JSON.stringify(records)).toBe(before);
});
