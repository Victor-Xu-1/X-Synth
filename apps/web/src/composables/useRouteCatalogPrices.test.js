import { ref, nextTick, defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import {
  routeCatalogPrices,
  useRouteCatalogPrices,
} from "./useRouteCatalogPrices";
import { priceContractResponse } from "@/common/route-price-test-data";

// Response-binding boundary cases contain no invented supplier prices or quotes.
const snapshot = "a".repeat(64);
function response(smiles = "CCO") {
  return {
    ...priceContractResponse(),
    snapshot,
    requested: [{ smiles, canonical_smiles: smiles }],
    results: { [smiles]: [] },
  };
}
test("empty exact catalog results remain unpriced and snapshot/query mismatches are rejected", () => {
  expect(routeCatalogPrices(response(), ["CCO"], snapshot)).toEqual({
    CCO: null,
  });
  expect(() => routeCatalogPrices(response("CCN"), ["CCO"], snapshot)).toThrow(
    "输入回执",
  );
  expect(() => routeCatalogPrices(response(), ["CCO"], "b".repeat(64))).toThrow(
    "采购快照不同",
  );
  expect(() =>
    routeCatalogPrices({ ...response(), requested: [] }, ["CCO"], snapshot),
  ).toThrow("响应无效");
  expect(() =>
    routeCatalogPrices({ ...response(), results: {} }, ["CCO"], snapshot),
  ).toThrow("输入回执");
});

test("route reading batches leaf structures only and discards late results for an earlier route", async () => {
  const graph = ref({
    nodes: [
      { id: "target", type: "molecule", smiles: "CC=O" },
      { id: "leaf", type: "molecule", smiles: "CCO" },
    ],
    edges: [{ source: "leaf", target: "target" }],
    target_id: "target",
  });
  const enabled = ref(false),
    expectedSnapshot = ref(snapshot);
  const pending = [];
  const api = {
    post(path, body) {
      return new Promise((resolve) => pending.push({ path, body, resolve }));
    },
  };
  let state;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useRouteCatalogPrices({
          graph,
          enabled,
          expectedSnapshot,
          api,
        });
        return () => null;
      },
    }),
  );
  expect(pending).toHaveLength(0);
  enabled.value = true;
  await nextTick();
  expect(pending[0].body).toEqual({ smiles: ["CCO"] });
  graph.value = {
    nodes: [{ id: "next", type: "molecule", smiles: "CCN" }],
    edges: [],
    target_id: "next",
  };
  await nextTick();
  pending[0].resolve(response());
  await flushPromises();
  expect(state.prices.value).toEqual({});
  pending[1].resolve(response("CCN"));
  await flushPromises();
  expect(state.prices.value).toEqual({ CCN: null });
  wrapper.unmount();
});

test("hidden, replaced and disposed route price reads retire their connection", async () => {
  const graph = ref({ nodes: [{ id: "leaf", type: "molecule", smiles: "CCO" }], edges: [] });
  const enabled = ref(true), expectedSnapshot = ref(snapshot), pending = [];
  const api = { post: jest.fn((path, body, query, options) =>
    new Promise(resolve => pending.push({ path, body, query, options, resolve }))) };
  let state;
  const wrapper = mount(defineComponent({ setup() {
    state = useRouteCatalogPrices({ graph, enabled, expectedSnapshot, api });
    return () => null;
  } }));
  expect(pending[0].options).toEqual({ signal: expect.any(AbortSignal), timeoutMs: 15000 });
  graph.value = { nodes: [{ id: "other", type: "molecule", smiles: "CCN" }], edges: [] };
  expect(pending[0].options.signal.aborted).toBe(true);
  expect(pending[1].options.signal.aborted).toBe(false);
  enabled.value = false;
  expect(pending[1].options.signal.aborted).toBe(true);
  expect(state.loading.value).toBe(false);
  enabled.value = true;
  wrapper.unmount(); expect(pending[2].options.signal.aborted).toBe(true);
  pending.forEach(item => item.resolve(response(item.body.smiles[0])));
  await flushPromises(); expect(state.prices.value).toEqual({});
  await state.refresh(); expect(api.post).toHaveBeenCalledTimes(3);
});
