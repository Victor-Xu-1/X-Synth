import { defineComponent, nextTick, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import MaterialTable from "./MaterialTable.vue";
import { calculationStubs, deferred } from "../assessment/test-support";
import { INPUT_ROLES } from "./process-form";
jest.mock("@/components/SmilesImage.vue", () => ({ template: "<div />" }));
jest.mock("@/components/workspace/StructureInput.vue", () => ({ name: "StructureInput", template: "<div />" }));
const read = jest.fn(), wrappers = [];
const Input = defineComponent({
  name: "StructureInput", props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"],
  setup(_, { expose }) { const pending = ref(false); expose({ pending, read }); },
  template: '<textarea :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
function setup() {
  const Host = defineComponent({ components: { MaterialTable }, setup() {
    const rows = ref([{ id: "one", name: "批号", role: "reactant", smiles: "CCO", mass: { value: 100, unit: "mg" } }]);
    return { rows, roles: INPUT_ROLES };
  }, template: '<MaterialTable v-model="rows" title="投料" :roles="roles" :minimum="1" />' });
  const wrapper = mount(Host, { global: { stubs: { ...calculationStubs, StructureInput: Input,
    VDialog: { props: ["modelValue"], template: '<div v-if="modelValue"><slot /></div>' },
  } } }); wrappers.push(wrapper); return wrapper;
}
beforeEach(() => read.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("edit is staged, and applying is explicit while cancellation preserves all original fields", async () => {
  const wrapper = setup(); await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click");
  await wrapper.get("textarea").setValue("CCN");
  expect(wrapper.vm.rows[0].smiles).toBe("CCO");
  await wrapper.get('[aria-label="关闭物料绘图"]').trigger("click");
  expect(wrapper.vm.rows[0].smiles).toBe("CCO");
  await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click"); read.mockResolvedValue("CCN");
  await wrapper.findAll("button").find((button) => button.text() === "应用结构").trigger("click"); await flushPromises();
  expect(wrapper.vm.rows[0]).toEqual({ id: "one", name: "批号", role: "reactant", smiles: "CCN", mass: { value: 100, unit: "mg" } });
});
test("failed/nullable reads never clear an identity; only the explicit clear command does", async () => {
  const wrapper = setup(); await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click"); read.mockResolvedValue(null);
  await wrapper.findAll("button").find((button) => button.text() === "应用结构").trigger("click"); await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("结构读取失败");
  expect(wrapper.vm.rows[0].smiles).toBe("CCO");
  await wrapper.findAll("button").find((button) => button.text() === "清除结构").trigger("click");
  expect(wrapper.vm.rows[0]).toMatchObject({ smiles: "", name: "批号", mass: { value: 100, unit: "mg" } });
});
test("cancelled and unmounted editor reads cannot overwrite the row later", async () => {
  const wrapper = setup(), late = deferred();
  await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click"); read.mockReturnValue(late.promise);
  await wrapper.findAll("button").find((button) => button.text() === "应用结构").trigger("click");
  await wrapper.get('[aria-label="关闭物料绘图"]').trigger("click"); late.resolve("CCN"); await flushPromises();
  expect(wrapper.vm.rows[0].smiles).toBe("CCO");
});
test("applying locks user interaction without disabling and cancelling its own native reader", async () => {
  const wrapper = setup(); await wrapper.get('[aria-label="编辑投料 1 结构"]').trigger("click");
  read.mockImplementation(async () => {
    await nextTick();
    expect(wrapper.getComponent(Input).props("disabled")).toBe(false);
    expect(wrapper.get(".material-editor-body").attributes("inert")).toBeDefined();
    return "CCN";
  });
  await wrapper.findAll("button").find((button) => button.text() === "应用结构").trigger("click"); await flushPromises();
  expect(wrapper.vm.rows[0].smiles).toBe("CCN");
});
