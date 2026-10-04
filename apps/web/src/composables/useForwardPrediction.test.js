import { defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useForwardPrediction } from "./useForwardPrediction";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const wrappers = [];
const row = { product: "CC=O", log_probability: -1.2, feasibility_score: 0 };
const response = (products = []) => ({
  reactants: "CCO", products, model: "graph2smiles_uspto_stereo",
  asset_identity: "a".repeat(64), evidence_type: "model_prediction",
  record_id: "unit-forward-record",
});
function setup() {
  const inputs = {
    reactants: ref(" CCO "), count: ref(5), results: ref([]), pending: ref(0),
    context: [ref("forward"), ref(false)], reportError: jest.fn(),
  };
  let state;
  const wrapper = mount(defineComponent({ setup() {
    state = useForwardPrediction(inputs);
    return () => null;
  } }));
  wrappers.push(wrapper);
  return { ...inputs, ...state, wrapper };
}
beforeEach(() => API.post.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("only explicit prediction uses the product endpoint, with no legacy backend or agents", async () => {
  const state = setup();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValue(response([row]));
  await state.predict();
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post).toHaveBeenCalledWith("/api/v1/reactions/predict", { reactants: "CCO", count: 5 });
  expect(state.results.value).toEqual([row]);
  expect(state.prediction.value.model).toBe("graph2smiles_uspto_stereo");
  expect(state.prediction.value.record_id).toBe("unit-forward-record");
  expect(state.results.value[0].log_probability).toBe(-1.2);
  expect(state.results.value[0].feasibility_score).toBe(0);
});
test.each([1, "10"])("accepts count boundary %s and honest empty candidates", async (count) => {
  const state = setup();
  state.count.value = count;
  API.post.mockResolvedValue(response());
  await state.predict();
  expect(API.post.mock.calls[0][1].count).toBe(Number(count));
  expect(state.submitted.value).toBe(true);
  expect(state.results.value).toEqual([]);
  expect(state.reportError).not.toHaveBeenCalled();
});
test.each([null, "", 0, 11, 1.5, NaN, Infinity])("rejects count %s without inference", async (count) => {
  const state = setup();
  state.count.value = count;
  await state.predict();
  expect(API.post).not.toHaveBeenCalled();
  expect(state.countError.value).toContain("1-10");
});
test.each([
  undefined, { ...response(), products: null }, { ...response(), model: "wldn5" },
  { ...response(), evidence_type: "validation" }, { ...response(), asset_identity: "bad" },
  response([{ ...row, product: "" }]), response([{ ...row, log_probability: "-1" }]),
  response([{ ...row, log_probability: -Infinity }]),
  response([{ ...row, log_probability: 1 }]),
  response([{ ...row, feasibility_score: NaN }]),
  response([{ ...row, feasibility_score: 1.1 }]), response(Array(6).fill(row)),
])("invalid output is an error, not a validated product", async (value) => {
  const state = setup();
  API.post.mockResolvedValue(value);
  await state.predict();
  expect(state.reportError).toHaveBeenCalled();
  expect(state.results.value).toEqual([]);
  expect(state.prediction.value).toBeNull();
});
test("duplicate submit stays blocked until completion; changing mode rejects late products", async () => {
  const state = setup();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const run = state.predict();
  await state.predict();
  expect(state.pending.value).toBe(1);
  expect(API.post).toHaveBeenCalledTimes(1);
  state.context[0].value = "context";
  finish(response([row]));
  await run;
  expect(state.pending.value).toBe(0);
  expect(state.results.value).toEqual([]);
});
test("editing reactants invalidates products and provenance synchronously", async () => {
  const state = setup();
  API.post.mockResolvedValue(response([row]));
  await state.predict();
  state.reactants.value = "O";
  expect(state.results.value).toEqual([]);
  expect(state.prediction.value).toBeNull();
  expect(state.submitted.value).toBe(false);
});
