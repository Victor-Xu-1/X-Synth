import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useStockSearch } from "./useStockSearch";

const wrappers = [];
function setup(api) {
  const smiles = ref("CCO"), expectedSnapshot = ref(null);
  let state;
  const wrapper = mount(defineComponent({
    setup() {
      state = useStockSearch({ smiles, expectedSnapshot, api });
      return () => null;
    },
  }));
  wrappers.push(wrapper);
  return { wrapper, smiles, expectedSnapshot, ...state };
}
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()));

test.each(["reset", "new structure", "new snapshot", "unmount"])(
  "%s retires structure validation and cannot start a late catalog query", async action => {
    let resolve;
    const api = { post: jest.fn(() => new Promise(done => { resolve = done; })) };
    const state = setup(api), run = state.search();
    const options = api.post.mock.calls[0][3];
    expect(options).toEqual({ signal: expect.any(AbortSignal), timeoutMs: 15000 });
    if (action === "reset") state.reset();
    else if (action === "new structure") state.smiles.value = "O";
    else if (action === "new snapshot") state.expectedSnapshot.value = "a".repeat(64);
    else state.wrapper.unmount();
    expect(options.signal.aborted).toBe(true);
    resolve({ smiles: "CCO" }); await run;
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(state.matchedResult.value).toBeNull();
    expect(state.error.value).toBe("");
  },
);

test("catalog lookup uses the same retirement signal and a bounded individual request", async () => {
  let resolve;
  const api = { post: jest.fn().mockResolvedValueOnce({ smiles: "CCO" })
    .mockImplementationOnce(() => new Promise(done => { resolve = done; })) };
  const state = setup(api), run = state.search();
  await flushPromises();
  const validation = api.post.mock.calls[0][3], catalog = api.post.mock.calls[1][3];
  expect(catalog).toEqual({ signal: validation.signal, timeoutMs: 15000 });
  state.reset(); expect(catalog.signal.aborted).toBe(true);
  resolve({ snapshot: "a".repeat(64), results: { CCO: [] } }); await run;
  expect(state.matchedResult.value).toBeNull();
  expect(state.loading.value).toBe(false);
});

test("current timeout is readable and a fresh explicit retry uses a new signal", async () => {
  const api = { post: jest.fn().mockRejectedValueOnce(new DOMException("network wait", "TimeoutError"))
    .mockResolvedValueOnce({ smiles: "CCO" })
    .mockResolvedValueOnce({ snapshot: "a".repeat(64), results: { CCO: [] } }) };
  const state = setup(api); await state.search();
  expect(state.error.value).toBe("服务请求超时，请刷新或重试。");
  expect(state.loading.value).toBe(false);
  const previous = api.post.mock.calls[0][3].signal;
  await state.search();
  expect(api.post.mock.calls[1][3].signal).not.toBe(previous);
  expect(state.error.value).toBe("");
  expect(state.matchedResult.value.records).toEqual([]);
});

test("a released consumer cannot issue another request", async () => {
  const api = { post: jest.fn() }, state = setup(api);
  state.wrapper.unmount(); await state.search();
  expect(api.post).not.toHaveBeenCalled();
});
