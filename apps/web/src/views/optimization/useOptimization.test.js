import { TextDecoder, TextEncoder } from "node:util";
import { defineComponent } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { API } from "@/common/api";
import { useOptimization } from "./useOptimization";

jest.mock("@/common/api", () => ({
  API: {
    get: jest.fn(),
    post: jest.fn(),
    toErrorObject: (error) => ({ string_error: error.message }),
  },
}));
jest.mock("file-saver", () => ({ saveAs: jest.fn() }));
global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
const CSV = "temperature,solvent,response\n10,a,1\n20,a,2\n10,b,3\n20,b,4\n";
const table = {
  table_sha256: "a".repeat(64),
  row_count: 4,
  columns: [
    { name: "temperature", numeric: true, values: ["10", "20"] },
    { name: "solvent", numeric: false, values: ["a", "b"] },
    { name: "response", numeric: true, values: ["1", "2", "3", "4"] },
  ],
  rows: [],
};
const file = (name = "measurements.csv") => ({
  name,
  size: CSV.length,
  arrayBuffer: async () => new TextEncoder().encode(CSV).buffer,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const wrappers = [];
function setup(options = {}) {
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useOptimization(options);
        return {};
      },
      template: "<div />",
    }),
  );
  wrappers.push(wrapper);
  return { state, wrapper };
}
async function confirmed(state) {
  API.post.mockResolvedValueOnce(table);
  await state.chooseFile(file());
  state.selectedRows.value = [1, 2, 3];
  state.toggleFactor(table.columns[0]);
  state.toggleFactor(table.columns[1]);
  state.target.name = "response";
  state.batchSize.value = 1;
  state.confirmedMeasurements.value = true;
  state.confirmedCandidates.value = true;
}
function response(body) {
  return {
    engine: "BayBE",
    seed: body.seed,
    versions: { baybe: "0.15.0" },
    empirically_confirmed: false,
    table_sha256: body.table_sha256,
    measurement_count: 3,
    selected_rows: body.selected_rows,
    target: body.target,
    recommendations: [
      {
        conditions: { temperature: 20, solvent: "b" },
        posterior_mean: 0,
        posterior_std: 1,
      },
    ],
    record_id: "a".repeat(32),
    csv_content: "protocol fixture",
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  API.post.mockReset();
  API.get.mockResolvedValue({ ready: true, versions: { baybe: "0.15.0" } });
});
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

test("opening/importing only inspects actual file and never chooses rows, factors or starts Bayesian computation", async () => {
  const { state } = setup();
  await flushPromises();
  expect(API.post).not.toHaveBeenCalled();
  API.post.mockResolvedValueOnce(table);
  await state.chooseFile(file());
  expect(state.selectedRows.value).toEqual([]);
  expect(state.factors.value).toEqual([]);
  expect(state.target.name).toBe("");
  expect(API.post).toHaveBeenCalledTimes(1);
  expect(API.post.mock.calls[0][0]).toBe("/api/v1/optimization/inspect");
});

test("actual UTF-8 upload decoding preserves the BOM and CRLF bytes sent for inspection", async () => {
  const { state } = setup();
  const source = "\ufeff" + CSV.replace(/\n/g, "\r\n");
  const bytes = new TextEncoder().encode(source);
  API.post.mockResolvedValueOnce(table);
  await state.chooseFile({ name: "bom.csv", size: bytes.length, arrayBuffer: async () => bytes.buffer });
  expect(API.post).toHaveBeenCalledWith("/api/v1/optimization/inspect", { content: source });
  expect([...new TextEncoder().encode(state.content.value)]).toEqual([...bytes]);
});
test("late file reads/inspection cannot replace a more recently selected actual file", async () => {
  const { state } = setup();
  const old = deferred();
  API.post.mockReturnValueOnce(old.promise).mockResolvedValueOnce(table);
  const first = state.chooseFile(file("old.csv"));
  await flushPromises();
  await state.chooseFile(file("current.csv"));
  old.resolve({ ...table, table_sha256: "b".repeat(64) });
  await first;
  expect(state.fileName.value).toBe("current.csv");
  expect(state.table.value.table_sha256).toBe("a".repeat(64));
});
test("changed factor levels invalidate both confirmations and prevent a late model result from appearing", async () => {
  const { state } = setup();
  await confirmed(state);
  await flushPromises();
  const pending = deferred();
  API.post.mockReturnValueOnce(pending.promise);
  const call = state.recommend();
  const body = API.post.mock.calls.at(-1)[1];
  state.factors.value[0].levels = "10\n20\n30";
  expect(state.confirmedMeasurements.value).toBe(false);
  expect(state.confirmedCandidates.value).toBe(false);
  pending.resolve(response(body));
  await call;
  expect(state.result.value).toBeNull();
  expect(state.running.value).toBe(false);
});
test("response success accepts persisted record id and target changes invalidate the current result", async () => {
  const { state } = setup();
  await confirmed(state);
  await flushPromises();
  API.post.mockImplementationOnce((_, body) => Promise.resolve(response(body)));
  await state.recommend();
  expect(state.result.value.record_id).toBe("a".repeat(32));
  state.target.unit = "new unit";
  expect(state.result.value).toBeNull();
});
test("failures hide old suggestions and no background retries or fake result occurs", async () => {
  const { state } = setup();
  await confirmed(state);
  await flushPromises();
  API.post.mockRejectedValueOnce(new Error("BayBE failed"));
  await state.recommend();
  expect(state.result.value).toBeNull();
  expect(state.error.value).toBe("BayBE failed");
  expect(state.running.value).toBe(false);
  expect(API.post).toHaveBeenCalledTimes(2);
});
test("unmount discards late compute success and oversized imports have no partial selection", async () => {
  const { state, wrapper } = setup();
  await confirmed(state);
  await flushPromises();
  const pending = deferred();
  API.post.mockReturnValueOnce(pending.promise);
  const call = state.recommend(),
    body = API.post.mock.calls.at(-1)[1];
  wrapper.unmount();
  pending.resolve(response(body));
  await call;
  expect(state.result.value).toBeNull();
  const other = setup().state;
  await other.chooseFile({ size: 2 * 1024 * 1024 + 1 });
  expect(other.table.value).toBeNull();
  expect(other.error.value).toContain("2 MiB");
});
test("selecting a response that was a factor removes the incompatible factor and respects explicit page selection limits", async () => {
  const { state } = setup();
  await confirmed(state);
  state.updateTarget({ name: "temperature" });
  expect(state.factors.value.map((factor) => factor.name)).toEqual(["solvent"]);
  state.selectedRows.value = Array.from({ length: 250 }, (_, i) => i + 1);
  state.selectPage(
    Array.from({ length: 50 }, (_, i) => i + 251),
    true,
  );
  expect(state.selectedRows.value.length).toBe(250);
  expect(state.error.value).toContain("256");
});

test("validated recommendation is delivered to the persisted result view only once", async () => {
  const onResult = jest.fn().mockResolvedValue(undefined);
  const { state } = setup({ onResult }); await confirmed(state); await flushPromises();
  API.post.mockImplementationOnce((_, body) => Promise.resolve(response(body)));
  await state.recommend();
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenCalledWith(state.result.value);
});

test("a failed result-page navigation retains the validated saved result for an explicit recovery link", async () => {
  const onResult = jest.fn().mockRejectedValue(new Error("结果已保存，但结果页面未能打开。"));
  const { state } = setup({ onResult }); await confirmed(state); await flushPromises();
  API.post.mockImplementationOnce((_, body) => Promise.resolve(response(body)));
  await state.recommend();
  expect(state.result.value.record_id).toBe("a".repeat(32));
  expect(state.error.value).toContain("结果已保存");
  expect(state.running.value).toBe(false);
  expect(onResult).toHaveBeenCalledTimes(1);
});

test("an externally blocked saved-input read cannot start inspection or computation", async () => {
  const { state } = setup({ blocked: () => true }); await flushPromises();
  await state.chooseFile(file()); await state.recommend();
  expect(API.post).not.toHaveBeenCalled(); expect(state.canRecommend.value).toBe(false);
});

test("saved restore only inspects data, clears confirmations and cannot overwrite a newer file", async () => {
  const { state } = setup(); await confirmed(state);
  const request = API.post.mock.calls[0][1];
  const input = { content: request.content, table_sha256: table.table_sha256, selected_rows: [1, 2, 3],
    factors: [{ name: "temperature", kind: "numerical", values: [10, 20] }, { name: "solvent", kind: "categorical", values: ["a", "b"] }],
    target: { name: "response", kind: "response", direction: "minimize", unit: "mM" }, batch_size: 1, seed: 0,
    confirmed_measurements: true, confirmed_candidates: true };
  const held = deferred(); API.post.mockReturnValueOnce(held.promise);
  const old = state.restoreInput(input);
  API.post.mockResolvedValueOnce(table);
  await state.chooseFile(file("newer.csv")); held.resolve(table); await old;
  expect(state.fileName.value).toBe("newer.csv"); expect(state.selectedRows.value).toEqual([]);
  expect(state.confirmedMeasurements.value).toBe(false); expect(state.confirmedCandidates.value).toBe(false);
  expect(API.post.mock.calls.every(([url]) => url.endsWith("/inspect"))).toBe(true);
});

test("restored unnamed CSV has no display sentinel in fileName and a chosen literal sentinel name remains authoritative", async () => {
  const { state } = setup();
  const input = { content: CSV, table_sha256: table.table_sha256, selected_rows: [1, 2, 3],
    factors: [{ name: "temperature", kind: "numerical", values: [10, 20] }],
    target: { name: "response", kind: "response", direction: "minimize", unit: "mM" }, batch_size: 1, seed: 0,
    confirmed_measurements: true, confirmed_candidates: true };
  const original = JSON.stringify(input);
  API.post.mockResolvedValue(table);
  await state.restoreInput(input);
  expect(state.fileName.value).toBe("");
  expect(state.content.value).toBe(CSV);
  expect(state.selectedRows.value).toEqual([1, 2, 3]);
  await state.chooseFile(file("已保存的实测 CSV"));
  expect(state.fileName.value).toBe("已保存的实测 CSV");
  expect(state.content.value).toBe(CSV);
  expect(state.table.value.table_sha256).toBe(table.table_sha256);
  expect(state.confirmedMeasurements.value).toBe(false);
  expect(state.confirmedCandidates.value).toBe(false);
  expect(JSON.stringify(input)).toBe(original);
  expect(API.post.mock.calls).toEqual(Array.from({ length: 2 }, () => ["/api/v1/optimization/inspect", { content: CSV }]));
});
