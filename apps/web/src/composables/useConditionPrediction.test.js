import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useConditionPrediction } from "./useConditionPrediction";

jest.mock("@/common/api", () => ({ API: { post: jest.fn() } }));
const wrappers = [];
const result = (conditions = []) => ({
  reactants: "CCO",
  product: "CC=O",
  model: "nn_v1",
  evidence_type: "model_prediction",
  asset_identity: "a".repeat(64),
  record_id: "unit-condition-record",
  conditions,
});
const row = { temperature: 25, solvent: "", reagent: "", catalyst: "", score: 0 };
const metadata = {
  solvent: { label: "", smiles: null, status: "not_predicted" },
  reagent: { label: "", smiles: null, status: "not_predicted" },
  catalyst: { label: "", smiles: null, status: "not_predicted" },
};
function setup() {
  const inputs = {
    reactants: ref(" CCO "),
    product: ref(" CC=O "),
    count: ref(5),
    results: ref([]),
    pending: ref(0),
    reportError: jest.fn(),
    onInvalidate: jest.fn(),
    context: [ref("context"), ref(false)],
  };
  let state;
  const wrapper = mount(defineComponent({
    setup() {
      state = useConditionPrediction(inputs);
      return () => null;
    },
  }));
  wrappers.push(wrapper);
  return { ...inputs, ...state, wrapper };
}
beforeEach(() => API.post.mockReset());
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("prefilled inputs never predict; an explicit call uses the product endpoint once", async () => {
  const state = setup();
  await nextTick();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValue(result([row]));
  await state.predict();
  expect(API.post).toHaveBeenCalledWith("/api/v1/conditions/predict", {
    reactants: "CCO", product: "CC=O", count: 5,
  });
  expect(state.results.value).toEqual([row]);
  expect(state.prediction.value.model).toBe("nn_v1");
  expect(state.prediction.value.record_id).toBe("unit-condition-record");
  expect(state.submitted.value).toBe(true);
  expect(state.pending.value).toBe(0);
});

test.each([null, "", " ", 0, -1, 21, 1.5, NaN, Infinity, "Infinity"])(
  "rejects invalid count %s without calling a model", async (count) => {
    const state = setup();
    state.count.value = count;
    await state.predict();
    expect(API.post).not.toHaveBeenCalled();
    expect(state.reportError).toHaveBeenCalled();
    expect(state.countError.value).not.toBe("");
    expect(state.pending.value).toBe(0);
  },
);

test.each([1, "20"])("accepts the count boundary %s", async (count) => {
  const state = setup();
  state.count.value = count;
  API.post.mockResolvedValue(result());
  await state.predict();
  expect(API.post.mock.calls[0][1].count).toBe(Number(count));
  expect(state.submitted.value).toBe(true);
  expect(state.results.value).toEqual([]);
});

test.each(["reactants", "product"])("rejects an empty %s without throwing", async (field) => {
  const state = setup();
  state[field].value = null;
  await state.predict();
  expect(API.post).not.toHaveBeenCalled();
  expect(state.reportError).toHaveBeenCalled();
});

test("same-tick edits invalidate old rows and do not discard a new request", async () => {
  const state = setup();
  API.post.mockResolvedValue(result([row]));
  await state.predict();
  state.count.value = 1;
  expect(state.results.value).toEqual([]);
  expect(state.prediction.value).toBeNull();
  expect(state.submitted.value).toBe(false);
  expect(state.onInvalidate).toHaveBeenCalled();
  await state.predict();
  expect(state.results.value).toEqual([row]);
});

test("a pending request owns the busy counter and prevents duplicate inference", async () => {
  const state = setup();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const request = state.predict();
  expect(state.pending.value).toBe(1);
  await state.predict();
  expect(API.post).toHaveBeenCalledTimes(1);
  state.count.value = 2;
  await state.predict();
  expect(state.pending.value).toBe(1);
  finish(result([row]));
  await request;
  expect(state.results.value).toEqual([]);
  expect(state.pending.value).toBe(0);
});

test("opening a draft or switching tools invalidates late results even after returning", async () => {
  const state = setup();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const request = state.predict();
  state.context[1].value = true;
  state.context[1].value = false;
  finish(result([row]));
  await request;
  expect(state.results.value).toEqual([]);
  expect(state.reportError).not.toHaveBeenCalled();
});

test("errors are visible for the current input but late errors are ignored", async () => {
  const state = setup();
  const error = new Error("service_unavailable");
  API.post.mockRejectedValue(error);
  await state.predict();
  expect(state.reportError).toHaveBeenCalledWith("反应条件推荐失败", error);
  state.reportError.mockClear();
  let fail;
  API.post.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const request = state.predict();
  state.product.value = "O";
  fail(error);
  await request;
  expect(state.reportError).not.toHaveBeenCalled();
  expect(state.pending.value).toBe(0);
});

test.each([
  undefined,
  { ...result(), conditions: null },
  { ...result(), model: "quarc" },
  { ...result(), evidence_type: "experimental" },
  { ...result(), asset_identity: "unknown" },
  result([{ ...row, temperature: Infinity }]),
  result([{ ...row, temperature: -274 }]),
  result([{ ...row, score: "0.1" }]),
  result([{ ...row, score: NaN }]),
  result([{ ...row, score: 1.1 }]),
  result([{ ...row, catalyst: null }]),
  result(Array(6).fill(row)),
])("invalid model payload is an error, never an empty successful result", async (response) => {
  const state = setup();
  API.post.mockResolvedValue(response);
  await state.predict();
  expect(state.reportError).toHaveBeenCalled();
  expect(state.results.value).toEqual([]);
  expect(state.prediction.value).toBeNull();
  expect(state.submitted.value).toBe(false);
});

test("typed ingredient identities preserve raw labels without changing model output", async () => {
  const state = setup();
  const typed = { ...row, solvent: "OCC", reagent: "raw reagent label", ingredients: {
    ...metadata,
    solvent: { label: "OCC", smiles: "CCO", status: "structure" },
    reagent: { label: "raw reagent label", smiles: null, status: "label_only" },
  } };
  API.post.mockResolvedValue(result([typed]));
  await state.predict();
  expect(state.reportError).not.toHaveBeenCalled();
  expect(state.results.value[0]).toEqual(typed);
});
test.each([
  null, [], {},
  { ...metadata, solvent: { label: "different", smiles: null, status: "not_predicted" } },
  { ...metadata, solvent: { label: "", smiles: "CCO", status: "not_predicted" } },
  { ...metadata, solvent: { label: "", smiles: null, status: "structure" } },
  { ...metadata, solvent: { label: "", smiles: null, status: "label_only" } },
  { ...metadata, solvent: { label: "", smiles: null, status: "unknown" } },
])("present invalid ingredient metadata is a visible error", async (ingredients) => {
  const state = setup();
  API.post.mockResolvedValue(result([{ ...row, ingredients }]));
  await state.predict();
  expect(state.reportError).toHaveBeenCalled();
  expect(state.results.value).toEqual([]);
});

test("unmounted requests cannot publish results or errors", async () => {
  const state = setup();
  let finish;
  API.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const request = state.predict();
  state.wrapper.unmount();
  finish(result([row]));
  await request;
  expect(state.results.value).toEqual([]);
  expect(state.reportError).not.toHaveBeenCalled();
});
