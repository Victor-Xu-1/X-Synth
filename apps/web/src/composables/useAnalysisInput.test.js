import { defineComponent, reactive } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useRoute } from "vue-router";
import { API } from "@/common/api";
import { useAnalysisInput } from "./useAnalysisInput";
jest.mock("vue-router", () => ({ useRoute: jest.fn() }));
jest.mock("@/common/api", () => ({ API: { get: jest.fn() } }));
const wrappers = [], apply = jest.fn(), clear = jest.fn(), prefill = jest.fn();
const record = (id, kind = "process") => ({ id, kind, status: "completed", created: "2026-10-08T00:00:00Z", inputs: { saved: id }, result: {} });
function setup(query, fullPath = "/process") {
  const route = reactive({ query, fullPath }); useRoute.mockReturnValue(route);
  const Host = defineComponent({ setup() { return useAnalysisInput({ kind: "process", clear, apply, prefill }); }, template: '<div>{{ error }}</div>' });
  const wrapper = mount(Host); wrappers.push(wrapper); return { wrapper, route };
}
beforeEach(() => { API.get.mockReset(); apply.mockReset(); clear.mockReset(); prefill.mockReset(); window.history.replaceState({}, ""); });
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
test("browser Back restores only a pointer bound to the exact originating page and kind", async () => {
  window.history.replaceState({ xSynthSubmittedInput: { version: 1, kind: "process", id: "new-record", location: "/process?record=old-record" } }, "");
  API.get.mockResolvedValue(record("new-record"));
  setup({ record: "old-record" }, "/process?record=old-record"); await flushPromises();
  expect(API.get).toHaveBeenCalledWith("/api/v1/analyses/new-record", null, false);
  expect(apply).toHaveBeenCalledWith({ saved: "new-record" });
});
test("a pointer for a different input URL cannot overwrite a fresh target", async () => {
  window.history.replaceState({ xSynthSubmittedInput: { version: 1, kind: "process", id: "old", location: "/process?smiles=CCO" } }, "");
  setup({ smiles: "CCN" }, "/process?smiles=CCN"); await flushPromises();
  expect(API.get).not.toHaveBeenCalled(); expect(prefill).toHaveBeenCalledWith("CCN", { smiles: "CCN" });
});
test("stale record reads and unmounted views do not overwrite the current form", async () => {
  let finish;
  API.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce(record("two"));
  const { wrapper, route } = setup({ record: "one" });
  route.query = { record: "two" }; await flushPromises();
  finish(record("one")); await flushPromises();
  expect(apply.mock.calls).toEqual([[{ saved: "two" }]]);
  wrapper.unmount(); await wrapper.vm.reload(); expect(API.get).toHaveBeenCalledTimes(2);
});
test("wrong kinds and conflicting seeds cannot become valid input", async () => {
  API.get.mockResolvedValue(record("one", "assessment")); const { wrapper } = setup({ record: "one" });
  await flushPromises(); expect(wrapper.text()).toContain("不属于当前核算类型"); expect(apply).not.toHaveBeenCalled();
  const other = setup({ record: "one", smiles: "CCO" }).wrapper; await flushPromises();
  expect(other.text()).toContain("不能同时指定"); expect(API.get).toHaveBeenCalledTimes(1);
});

test("new input resets a restored history entry even when its URL is unchanged, retaining unrelated history state", async () => {
  window.history.replaceState({ position: 3, xSynthSubmittedInput: { version: 1, kind: "process", id: "saved", location: "/process" } }, "");
  API.get.mockResolvedValue(record("saved"));
  const { wrapper } = setup({}); await flushPromises();
  expect(wrapper.vm.source.id).toBe("saved");
  clear.mockClear(); wrapper.vm.startNew({ defaultPrevented: true });
  expect(wrapper.vm.source).toBeNull(); expect(wrapper.vm.error).toBe("");
  expect(clear).toHaveBeenCalledTimes(1);
  expect(window.history.state).toEqual({ position: 3 });
  await wrapper.vm.reload();
  expect(API.get).toHaveBeenCalledTimes(1);
  expect(prefill).toHaveBeenLastCalledWith("", {});
});

test("new input exits failed recovery and discards late reads without clearing modified-click history", async () => {
  let finish;
  API.get.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  window.history.replaceState({ xSynthSubmittedInput: { version: 1, kind: "process", id: "saved", location: "/process" } }, "");
  const { wrapper } = setup({});
  wrapper.vm.startNew({ ctrlKey: true }); expect(window.history.state.xSynthSubmittedInput.id).toBe("saved");
  wrapper.vm.startNew(); finish(record("saved")); await flushPromises();
  expect(apply).not.toHaveBeenCalled(); expect(wrapper.vm.loading).toBe(false);
  wrapper.vm.error = "failed restore"; wrapper.vm.startNew();
  expect(wrapper.vm.error).toBe(""); expect(wrapper.vm.source).toBeNull();
});
