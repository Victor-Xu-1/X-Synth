import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useTaskParameters } from "./useTaskParameters";
const wrappers = [];
const response = id => ({ job_id: id, target_smiles: "CCO", settings: { smiles: "CCO", expansion_time: 127 } });
function setup(api) {
  const id = ref("task-a"), open = ref(false); let value;
  const wrapper = mount(defineComponent({ setup() { value = useTaskParameters({ id, open, api }); return () => null; } }));
  wrappers.push(wrapper); return { id, open, wrapper, ...value };
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));
test("parameters load only on demand and retry without loading route results", async () => {
  const api = { get: jest.fn().mockResolvedValue(response("task-a")) }, s = setup(api);
  expect(api.get).not.toHaveBeenCalled(); s.open.value = true; await flushPromises();
  expect(s.data.value.settings.expansion_time).toBe(127); expect(s.loading.value).toBe(false);
  s.open.value = false; await nextTick(); s.open.value = true; await flushPromises(); expect(api.get).toHaveBeenCalledTimes(2);
});
test("closing, new context and unmount retire the read and cannot publish late data", async () => {
  let finish; const api = { get: jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; })) };
  const s = setup(api); s.open.value = true; await nextTick(); const signal = api.get.mock.calls[0][3].signal;
  s.open.value = false; await nextTick(); expect(signal.aborted).toBe(true);
  finish(response("task-a")); await flushPromises(); expect(s.data.value).toBeNull(); expect(s.loading.value).toBe(false);
  s.id.value = "task-b"; s.open.value = true; await nextTick(); const next = api.get.mock.calls[1][3].signal;
  s.wrapper.unmount(); expect(next.aborted).toBe(true); finish(response("task-b")); await flushPromises(); expect(s.data.value).toBeNull();
});
test("a failed current read stays visible, then explicit retry restores its original parameters", async () => {
  const api = { get: jest.fn().mockRejectedValueOnce(new Error("network unavailable")).mockResolvedValueOnce(response("task-a")) }, s = setup(api);
  s.open.value = true; await flushPromises(); expect(s.data.value).toBeNull(); expect(s.error.value).toBeTruthy();
  await s.reload(); expect(s.error.value).toBe(""); expect(s.data.value.job_id).toBe("task-a");
});
