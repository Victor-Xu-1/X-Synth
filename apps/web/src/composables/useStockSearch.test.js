import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useStockSearch } from "./useStockSearch";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const snapshot = "a".repeat(64),
  otherSnapshot = "b".repeat(64);
const response = (smiles, records = [{ smiles }], hash = snapshot) => ({
  snapshot: hash,
  results: { [smiles]: records },
});
const wrappers = [];
function setup(api, expectation = null) {
  const smiles = ref("CCO"),
    expectedSnapshot = ref(expectation);
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useStockSearch({ smiles, expectedSnapshot, api });
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  return { ...state, smiles, expectedSnapshot, wrapper };
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("prefill alone performs no validation, stock request or model call", () => {
  const api = { post: jest.fn() };
  const state = setup(api, snapshot);
  expect(api.post).not.toHaveBeenCalled();
  expect(state.matchedResult.value).toBeNull();
  expect(state.snapshotMatches.value).toBeNull();
});
test("structure and supplier evidence become visible only as one completed result", async () => {
  const lookup = deferred();
  const api = {
    post: jest
      .fn()
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockReturnValueOnce(lookup.promise),
  };
  const state = setup(api, snapshot),
    search = state.search();
  await Promise.resolve();
  expect(state.matchedResult.value).toBeNull();
  lookup.resolve(response("CCO"));
  await search;
  expect(state.matchedResult.value).toEqual({
    query: "CCO",
    expectedSnapshot: snapshot,
    smiles: "CCO",
    snapshot,
    records: [{ smiles: "CCO" }],
  });
  expect(state.snapshotMatches.value).toBe(true);
});
test("successful A followed by failed B never leaves A records under B", async () => {
  const api = {
    post: jest
      .fn()
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockResolvedValueOnce(response("CCO"))
      .mockResolvedValueOnce({ smiles: "O" })
      .mockRejectedValueOnce(
        new Error(JSON.stringify({ detail: "lookup unavailable" })),
      ),
  };
  const state = setup(api);
  await state.search();
  state.smiles.value = "O";
  expect(state.matchedResult.value).toBeNull();
  await state.search();
  expect(state.matchedResult.value).toBeNull();
  expect(state.error.value).toContain("lookup unavailable");
  expect(state.loading.value).toBe(false);
});
test("input changes invalidate validation before it can issue a stock request", async () => {
  const validate = deferred(),
    api = { post: jest.fn().mockReturnValue(validate.promise) };
  const state = setup(api),
    search = state.search();
  state.smiles.value = "O";
  validate.resolve({ smiles: "CCO" });
  await search;
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(state.matchedResult.value).toBeNull();
});
test("a changed task snapshot invalidates an outstanding lookup for the same structure", async () => {
  const lookup = deferred();
  const api = {
    post: jest
      .fn()
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockReturnValueOnce(lookup.promise),
  };
  const state = setup(api, snapshot),
    search = state.search();
  await Promise.resolve();
  state.expectedSnapshot.value = otherSnapshot;
  lookup.resolve(response("CCO"));
  await search;
  expect(state.matchedResult.value).toBeNull();
  expect(state.snapshotMatches.value).toBeNull();
});
test("older lookup completion cannot replace the latest result or end its loading state", async () => {
  const first = deferred(),
    second = deferred();
  const api = {
    post: jest
      .fn()
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockReturnValueOnce(second.promise),
  };
  const state = setup(api),
    one = state.search();
  await Promise.resolve();
  const two = state.search();
  await Promise.resolve();
  first.resolve(response("CCO"));
  await one;
  expect(state.loading.value).toBe(true);
  expect(state.matchedResult.value).toBeNull();
  second.resolve(response("CCO", [], otherSnapshot));
  await two;
  expect(state.matchedResult.value.snapshot).toBe(otherSnapshot);
  expect(state.loading.value).toBe(false);
});
test("snapshot mismatch is displayed as a mismatch, never original-task evidence", async () => {
  const api = {
    post: jest
      .fn()
      .mockResolvedValueOnce({ smiles: "CCO" })
      .mockResolvedValueOnce(response("CCO", [], otherSnapshot)),
  };
  const state = setup(api, snapshot);
  await state.search();
  expect(state.matchedResult.value.expectedSnapshot).toBe(snapshot);
  expect(state.matchedResult.value.snapshot).toBe(otherSnapshot);
  expect(state.snapshotMatches.value).toBe(false);
});
test("unmounted validation cannot continue to lookup or change visible state", async () => {
  const request = deferred(),
    api = { post: jest.fn().mockReturnValue(request.promise) };
  const state = setup(api),
    search = state.search();
  state.wrapper.unmount();
  request.resolve({ smiles: "CCO" });
  await search;
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(state.matchedResult.value).toBeNull();
});
test("errors and completions after reset or unmount cannot override newer state", async () => {
  const request = deferred(),
    api = { post: jest.fn().mockReturnValue(request.promise) };
  const state = setup(api),
    search = state.search();
  state.reset();
  state.wrapper.unmount();
  request.reject(new Error("late failure"));
  await search;
  expect(state.error.value).toBe("");
  expect(state.loading.value).toBe(false);
});
