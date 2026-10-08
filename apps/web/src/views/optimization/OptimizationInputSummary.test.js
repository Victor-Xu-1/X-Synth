import { flushPromises, mount } from "@vue/test-utils";
import { TextEncoder } from "node:util";
import { saveAs } from "file-saver";
import OptimizationInputSummary from "./OptimizationInputSummary.vue";
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));

test.each([
  {},
  { selected_rows: "1,2", factors: { name: "temperature" }, target: { name: {}, unit: [] }, seed: false },
  { selected_rows: [1, 1], factors: [null, { name: "temperature", values: { first: 10 } }], seed: -1 },
])("incomplete saved-input metadata renders missing facts without crashing or inventing defaults: %j", (input) => {
  const wrapper = mount(OptimizationInputSummary, { props: { inputs: input, recordId: "saved" }, global: { stubs: { VBtn: true } } });
  expect(wrapper.text()).toContain("未记录");
  expect(wrapper.text()).not.toContain("[object Object]");
  expect(wrapper.get(".optimization-input-facts").text()).toContain("随机种子未记录");
  expect(wrapper.find("button").exists()).toBe(false);
  wrapper.unmount();
});

test("saved-input summary keeps zero seed, exact declared units/direction and original CSV bytes", async () => {
  const input = Object.freeze({ content: '\ufefftemperature,response\r\n10,0\r\n20,2\r\n',
    selected_rows: [1, 2], target: { name: "response", direction: "minimize", unit: "mM" }, seed: 0,
    factors: [{ name: "temperature", kind: "numerical", values: [10, 20] }], table_sha256: "a".repeat(64) });
  const wrapper = mount(OptimizationInputSummary, { props: { inputs: input, recordId: "saved" }, global: { stubs: {
    VBtn: { template: '<button><slot /></button>' },
  } } });
  expect(wrapper.text()).toContain("最小化"); expect(wrapper.text()).toContain("mM");
  expect(wrapper.get(".optimization-input-facts").text()).toContain("随机种子0");
  await wrapper.get("button").trigger("click"); await flushPromises();
  const [blob, name] = saveAs.mock.calls.at(-1);
  expect(name).toBe("X-Synth-measurements-saved.csv");
  const bytes = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob); });
  expect([...bytes]).toEqual([...new TextEncoder().encode(input.content)]);
  wrapper.unmount();
});
