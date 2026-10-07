import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import MeasurementTable from "./MeasurementTable.vue";
import { useOptimization } from "./useOptimization";

jest.mock("@/common/api", () => ({ API: { get: jest.fn(), post: jest.fn() } }));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));

// Protocol-only rows exercise selection, not experimental data or model output.
const table = {
  table_sha256: "selection-protocol",
  row_count: 300,
  columns: [{ name: "record" }],
  rows: Array.from({ length: 300 }, (_, index) => ({
    index: index + 1, values: { record: `record-${index + 1}` },
  })),
};
let wrapper, state;
beforeEach(() => {
  API.get.mockResolvedValue({ ready: false });
  wrapper = mount(defineComponent({
    components: { MeasurementTable },
    setup() {
      state = useOptimization();
      state.table.value = table;
      return state;
    },
    template: '<MeasurementTable :table="table" :selected-rows="selectedRows" @select-page="selectPage" @toggle-row="toggleRow" />',
  }), { global: { stubs: {
    VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  } } });
});
afterEach(() => wrapper.unmount());

test("a rejected sixth-page selection restores the unchecked header and preserves 250 rows", async () => {
  for (let page = 1; page <= 5; page++) {
    await wrapper.get('[aria-label="选择本页实测记录"]').setValue(true);
    await wrapper.get('[aria-label="下一页"]').trigger("click");
  }
  await wrapper.get('[aria-label="选择本页实测记录"]').setValue(true);
  await flushPromises();
  expect(state.error.value).toContain("256");
  expect(state.selectedRows.value).toHaveLength(250);
  expect(wrapper.get('[aria-label="选择本页实测记录"]').element.checked).toBe(false);
  expect(wrapper.findAll('tbody input').every((input) => !input.element.checked)).toBe(true);
});

test("accepted selections and deselections share the authoritative row and header state", async () => {
  const header = wrapper.get('[aria-label="选择本页实测记录"]');
  await header.setValue(true);
  expect(header.element.checked).toBe(true);
  expect(state.selectedRows.value).toHaveLength(50);
  await wrapper.get('[aria-label="选择实测记录 1"]').setValue(false);
  expect(header.element.checked).toBe(false);
  expect(header.element.indeterminate).toBe(true);
  await header.setValue(true);
  await header.setValue(false);
  expect(header.element.checked).toBe(false);
  expect(header.element.indeterminate).toBe(false);
  expect(state.selectedRows.value).toEqual([]);
});

test("a rejected partially selected page retains its indeterminate header", async () => {
  state.selectedRows.value = [...Array.from({ length: 250 }, (_, i) => i + 1), 251];
  for (let page = 1; page <= 5; page++)
    await wrapper.get('[aria-label="下一页"]').trigger("click");
  const header = wrapper.get('[aria-label="选择本页实测记录"]');
  await header.setValue(true);
  expect(header.element.checked).toBe(false);
  expect(header.element.indeterminate).toBe(true);
  expect(state.selectedRows.value).toHaveLength(251);
});
