import { computed, onBeforeUnmount, ref, watch } from "vue";
import { API } from "@/common/api";
import {
  catalogRecordsForInputs,
  supplierPriceView,
} from "@/common/route-price";

export function routeCatalogPrices(response, requested, expectedSnapshot) {
  const { records, canonicalSmiles, snapshot } = catalogRecordsForInputs(
    response,
    requested,
  );
  if (expectedSnapshot && snapshot !== expectedSnapshot.toLowerCase())
    throw new Error("当前目录与原任务采购快照不同，未显示为该任务价格。");
  const values = {};
  for (const smiles of requested) {
    const rows = records[smiles];
    const recorded = rows.filter(
      (row) =>
        supplierPriceView(row, { snapshot, smiles: canonicalSmiles[smiles] })
          .status === "recorded",
    );
    // ISO currencies are unknown: supplier order is stable, not a cross-currency minimum.
    recorded.sort((a, b) =>
      `${a.source}/${a.catalog_id}`.localeCompare(
        `${b.source}/${b.catalog_id}`,
      ),
    );
    values[smiles] = recorded[0]
      ? { record: recorded[0], snapshot, count: recorded.length }
      : null;
  }
  return values;
}

export function useRouteCatalogPrices({
  graph,
  expectedSnapshot,
  enabled,
  api = API,
}) {
  const prices = ref({}),
    loading = ref(false),
    error = ref("");
  const smiles = computed(() =>
    [
      ...new Set(
        graph.value.nodes
          .filter(
            (node) =>
              node.type === "molecule" &&
              !graph.value.edges.some((edge) => edge.target === node.id),
          )
          .map((node) => node.smiles),
      ),
    ].sort(),
  );
  let generation = 0,
    alive = true;
  async function refresh() {
    const current = ++generation;
    prices.value = {};
    error.value = "";
    loading.value = false;
    if (!enabled.value || !smiles.value.length) return;
    const requested = [...smiles.value],
      expected = expectedSnapshot.value;
    loading.value = true;
    try {
      const response = await api.post("/api/v1/stock/lookup", {
        smiles: requested,
      });
      if (!alive || current !== generation) return;
      prices.value = routeCatalogPrices(response, requested, expected);
    } catch (failure) {
      if (alive && current === generation)
        error.value =
          failure.message?.startsWith("目录") ||
          failure.message?.startsWith("当前目录") ||
          failure.message?.startsWith("采购目录")
            ? failure.message
            : "目录价格查询失败，路线结构仍可查看。";
    } finally {
      if (alive && current === generation) loading.value = false;
    }
  }
  watch(
    [() => JSON.stringify(smiles.value), expectedSnapshot, enabled],
    refresh,
    { immediate: true, flush: "sync" },
  );
  onBeforeUnmount(() => {
    alive = false;
    generation++;
  });
  return { prices, loading, error, refresh };
}
