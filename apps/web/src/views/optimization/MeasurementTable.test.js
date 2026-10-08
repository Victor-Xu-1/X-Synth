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

test("selected-only reading preserves original row identities and does not change selection", async () => {
  state.selectedRows.value = [2, 99, 275];
  await wrapper.get('input[value="selected"]').setValue(true);
  expect(wrapper.findAll("tbody .opt-row-number").map(row => row.text())).toEqual(["2", "99", "275"]);
  expect(state.selectedRows.value).toEqual([2, 99, 275]);
  await wrapper.get('[aria-label="选择实测记录 99"]').setValue(false);
  expect(wrapper.findAll("tbody .opt-row-number").map(row => row.text())).toEqual(["2", "275"]);
  await wrapper.get('input[value="all"]').setValue(true);
  expect(wrapper.findAll("tbody .opt-row-number")[0].text()).toBe("1");
  expect(state.selectedRows.value).toEqual([2, 275]);
});

test("an empty selected-only view reports no selected experiments without selecting any", async () => {
  await wrapper.get('input[value="selected"]').setValue(true);
  expect(wrapper.findAll("tbody tr")).toHaveLength(0);
  expect(wrapper.get('.opt-selection-empty[role="status"]').text()).toBe("尚无已选实验数据");
  expect(wrapper.get('[aria-label="下一页"]').element.disabled).toBe(true);
});

test("table replacement resets reading mode and page while preserving raw zero and pending values", async () => {
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  state.selectedRows.value = [99];
  await wrapper.get('input[value="selected"]').setValue(true);
  state.table.value = { ...table, table_sha256: "replacement", row_count: 3,
    rows: [{ index: 1, values: { record: 0 } }, { index: 2, values: { record: "pending" } }, { index: 3, values: { record: "" } }] };
  await flushPromises();
  expect(wrapper.get('input[value="all"]').element.checked).toBe(true);
  expect(wrapper.findAll("tbody td:last-child").map(cell => cell.text())).toEqual(["0", "pending", "缺失"]);
});

test("reading filters retain their own pages and clamp selected pages after deselection", async () => {
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  state.selectedRows.value = Array.from({ length: 51 }, (_, i) => i + 1);
  await wrapper.get('input[value="selected"]').setValue(true);
  await wrapper.get('[aria-label="下一页"]').trigger("click");
  expect(wrapper.findAll("tbody .opt-row-number")[0].text()).toBe("51");
  await wrapper.get('[aria-label="选择实测记录 51"]').setValue(false);
  expect(wrapper.findAll("tbody .opt-row-number")[0].text()).toBe("1");
  await wrapper.get('input[value="all"]').setValue(true);
  expect(wrapper.findAll("tbody .opt-row-number")[0].text()).toBe("51");
});
