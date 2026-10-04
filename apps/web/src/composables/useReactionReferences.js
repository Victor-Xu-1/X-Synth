import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { API } from "@/common/api";
import {
  REFERENCE_SEARCH_PATH,
  REFERENCE_STATUS_PATH,
  referenceFailure,
  referenceLimit,
  referenceQuery,
  referenceReady,
  referenceReason,
  referenceResponse,
  referenceStatus,
  unavailableReferenceStatus,
} from "@/common/reaction-references";

export function useReactionReferences({
  product,
  reactants = ref([]),
  limit = ref(20),
  blocked = ref(false),
  context = [],
  api = API,
}) {
  const sourceStatus = ref(null),
    statusLoading = ref(false),
    statusError = ref("");
  const result = ref(null),
    actualInput = ref(null),
    loading = ref(false),
    error = ref("");
  const searched = ref(false);
  let generation = 0,
    statusGeneration = 0,
    alive = true;
  function invalidate() {
    generation++;
    result.value = null;
    actualInput.value = null;
    loading.value = false;
    error.value = "";
    searched.value = false;
  }
  const countError = computed(() => {
    try {
      referenceLimit(limit.value);
      return "";
    } catch (failure) {
      return referenceFailure(failure);
    }
  });
  const inputValid = computed(() => {
    try {
      referenceQuery({
        product: product.value,
        reactants: reactants.value,
        limit: limit.value,
      });
      return true;
    } catch {
      return false;
    }
  });
  const ready = computed(
    () => !statusLoading.value && referenceReady(sourceStatus.value),
  );
  const canSearch = computed(
    () => ready.value && inputValid.value && !loading.value && !blocked.value,
  );
  const unavailableReason = computed(() =>
    statusLoading.value
      ? "正在核对参考来源。"
      : statusError.value ||
        (!ready.value ? referenceReason(sourceStatus.value) : ""),
  );
  const searchState = computed(() =>
    loading.value
      ? "loading"
      : error.value
        ? "error"
        : result.value
          ? result.value.count
            ? "success"
            : "empty"
          : "idle",
  );
  const inputSnapshot = () =>
    JSON.stringify([
      product.value,
      reactants.value,
      limit.value,
      blocked.value,
      ...context.map((value) => value.value),
    ]);
  // Flush synchronously so an edit and revert cannot resurrect an earlier query.
  watch([product, reactants, limit, blocked, ...context], invalidate, {
    deep: true,
    flush: "sync",
  });

  async function loadStatus() {
    if (!alive) return;
    const current = ++statusGeneration;
    invalidate();
    sourceStatus.value = null;
    statusError.value = "";
    statusLoading.value = true;
    try {
      const response = await api.get(REFERENCE_STATUS_PATH, null, false);
      if (alive && current === statusGeneration)
        sourceStatus.value = referenceStatus(response);
    } catch (failure) {
      if (alive && current === statusGeneration) {
        sourceStatus.value = unavailableReferenceStatus(failure);
        if (!sourceStatus.value)
          statusError.value = referenceFailure(
            failure,
            "无法核对参考来源，检索未启用。",
          );
      }
    } finally {
      if (alive && current === statusGeneration) statusLoading.value = false;
    }
  }

  async function search() {
    if (!alive || !canSearch.value) return;
    const payload = referenceQuery({
      product: product.value,
      reactants: reactants.value,
      limit: limit.value,
    });
    invalidate();
    const requested = generation,
      input = inputSnapshot();
    const current = () =>
      alive && requested === generation && input === inputSnapshot();
    actualInput.value = {
      product: payload.product,
      reactants: [...payload.reactants],
    };
    searched.value = true;
    loading.value = true;
    try {
      const response = await api.post(REFERENCE_SEARCH_PATH, payload);
      if (current()) result.value = referenceResponse(response, payload);
    } catch (failure) {
      if (current()) error.value = referenceFailure(failure);
    } finally {
      if (current()) loading.value = false;
    }
  }

  onMounted(loadStatus);
  onBeforeUnmount(() => {
    alive = false;
    generation++;
    statusGeneration++;
  });
  return {
    sourceStatus,
    statusLoading,
    statusError,
    ready,
    unavailableReason,
    countError,
    result,
    actualInput,
    searched,
    loading,
    error,
    searchState,
    canSearch,
    loadStatus,
    search,
    invalidate,
  };
}
