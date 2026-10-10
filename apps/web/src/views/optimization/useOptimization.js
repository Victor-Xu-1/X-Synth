import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { API } from "@/common/api";
import { buildRequest, candidateCount, LIMITS, validateResult } from "./model";
import { savedOptimizationContent, restoreOptimization } from "./optimization-replay";

export function useOptimization({ onResult, blocked = () => false } = {}) {
  const content = ref(""),
    fileName = ref(""),
    table = ref(null);
  const selectedRows = ref([]),
    factors = ref([]);
  const target = reactive({
    name: "",
    kind: "yield_percent",
    direction: "maximize",
    unit: "%",
  });
  const batchSize = ref(3),
    seed = ref(42),
    confirmedMeasurements = ref(false),
    confirmedCandidates = ref(false);
  const health = ref(null),
    healthLoading = ref(true),
    fileLoading = ref(false),
    running = ref(false);
  const result = ref(null), error = ref(""), fileError = ref(false);
  let revision = 0,
    fileRevision = 0,
    disposed = false;

  function invalidate() {
    revision++;
    result.value = null;
    error.value = "";
    confirmedMeasurements.value = false;
    confirmedCandidates.value = false;
  }
  watch([selectedRows, factors, target, batchSize, seed], invalidate, {
    deep: true,
    flush: "sync",
  });
  onBeforeUnmount(() => {
    disposed = true;
    revision++;
    fileRevision++;
  });

  const count = computed(() => candidateCount(factors.value));
  const canRecommend = computed(
    () =>
      health.value?.ready === true &&
      !blocked() &&
      !running.value &&
      !fileLoading.value &&
      !fileError.value &&
      selectedRows.value.length >= 3 &&
      selectedRows.value.length <= LIMITS.measurements &&
      !!target.name &&
      factors.value.length > 0 &&
      count.value > 0 &&
      count.value <= LIMITS.candidates &&
      confirmedMeasurements.value &&
      confirmedCandidates.value,
  );

  async function refreshHealth() {
    healthLoading.value = true;
    try {
      const response = await API.get(
        "/api/v1/optimization/health",
        null,
        false,
      );
      if (!disposed) health.value = response;
    } catch (failure) {
      if (!disposed)
        health.value = {
          ready: false,
          reason: API.toErrorObject(failure).string_error,
        };
    } finally {
      if (!disposed) healthLoading.value = false;
    }
  }
  onMounted(refreshHealth);

  function clear() {
    fileRevision++;
    invalidate();
    table.value = null;
    content.value = "";
    fileName.value = "";
    selectedRows.value = [];
    factors.value = [];
    Object.assign(target, { name: "", kind: "yield_percent", direction: "maximize", unit: "%" });
    batchSize.value = 3; seed.value = 42;
    fileLoading.value = false;
    fileError.value = false;
  }
  async function restoreInput(input) {
    const ticket = ++fileRevision;
    const text = savedOptimizationContent(input);
    const inspected = await API.post("/api/v1/optimization/inspect", { content: text });
    if (disposed || ticket !== fileRevision) return;
    const restored = restoreOptimization(input, inspected);
    content.value = restored.content; table.value = inspected; fileName.value = "";
    selectedRows.value = restored.selectedRows; factors.value = restored.factors;
    Object.assign(target, restored.target); batchSize.value = restored.batchSize; seed.value = restored.seed;
    confirmedMeasurements.value = false; confirmedCandidates.value = false;
  }
  async function chooseFile(file) {
    if (disposed || running.value || blocked() || !file) return;
    invalidate();
    const ticket = ++fileRevision;
    fileError.value = false;
    fileLoading.value = true;
    try {
      if (file.size > LIMITS.bytes) throw new Error("CSV 超过 2 MiB，未导入。");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await file.arrayBuffer(),
      );
      if (disposed || ticket !== fileRevision) return;
      const response = await API.post("/api/v1/optimization/inspect", {
        content: text,
      });
      if (disposed || ticket !== fileRevision) return;
      clear();
      content.value = text;
      fileName.value = file.name;
      table.value = response;
    } catch (failure) {
      if (!disposed && ticket === fileRevision) {
        fileError.value = true;
        error.value = API.toErrorObject(
          failure,
          "实测 CSV 读取失败，请核对 UTF-8 文件与表头。",
        ).string_error;
      }
    } finally {
      if (!disposed && ticket === fileRevision) fileLoading.value = false;
    }
  }

  function retainTable() {
    if (disposed || running.value || fileLoading.value || blocked() || !table.value || !fileError.value) return;
    fileError.value = false; error.value = "";
  }

  function toggleRow(index) {
    if (running.value || blocked()) return;
    if (selectedRows.value.includes(index))
      selectedRows.value = selectedRows.value.filter(
        (value) => value !== index,
      );
    else if (selectedRows.value.length < LIMITS.measurements)
      selectedRows.value = [...selectedRows.value, index];
  }

  function selectPage(indices, selected) {
    if (running.value || blocked()) return;
    const additions = indices.filter(
      (index) => !selectedRows.value.includes(index),
    );
    if (
      selected &&
      selectedRows.value.length + additions.length > LIMITS.measurements
    ) {
      error.value = "本页选择会超过 256 条实测记录上限。";
      return;
    }
    selectedRows.value = selected
      ? [...selectedRows.value, ...additions]
      : selectedRows.value.filter((index) => !indices.includes(index));
  }

  function toggleFactor(column) {
    if (running.value || blocked()) return;
    const selected = factors.value.find(
      (factor) => factor.name === column.name,
    );
    if (selected)
      factors.value = factors.value.filter(
        (factor) => factor.name !== column.name,
      );
    else if (factors.value.length < LIMITS.factors)
      factors.value = [
        ...factors.value,
        {
          name: column.name,
          kind: column.numeric ? "numerical" : "categorical",
          levels: column.values.join("\n"),
        },
      ];
  }

  function updateTarget(updates) {
    if (running.value || blocked()) return;
    if (updates.name)
      factors.value = factors.value.filter(
        (factor) => factor.name !== updates.name,
      );
    Object.assign(target, updates);
  }

  function updateFactor(name, updates) {
    if (running.value || blocked()) return;
    factors.value = factors.value.map((factor) =>
      factor.name === name ? { ...factor, ...updates } : factor,
    );
  }

  async function recommend() {
    if (disposed || running.value || fileLoading.value || blocked() || health.value?.ready !== true) return;
    result.value = null;
    error.value = "";
    let request;
    try {
      request = buildRequest({
        content: content.value,
        table: table.value,
        selectedRows: selectedRows.value,
        factors: factors.value,
        target,
        batchSize: batchSize.value,
        seed: seed.value,
        confirmedMeasurements: confirmedMeasurements.value,
        confirmedCandidates: confirmedCandidates.value,
      });
    } catch (failure) {
      error.value = failure.message;
      return;
    }
    const ticket = ++revision;
    running.value = true;
    try {
      const response = await API.post(
        "/api/v1/optimization/recommend",
        request,
      );
      if (disposed || ticket !== revision) return;
      result.value = validateResult(response, request);
      if (onResult) await onResult(response);
    } catch (failure) {
      if (!disposed && ticket === revision)
        error.value = API.toErrorObject(failure).string_error;
    } finally {
      if (!disposed) running.value = false;
    }
  }

  return {
    content,
    fileName,
    table,
    selectedRows,
    factors,
    target,
    batchSize,
    seed,
    confirmedMeasurements,
    confirmedCandidates,
    health,
    healthLoading,
    fileLoading,
    running,
    result,
    error,
    fileError,
    retainTable,
    count,
    canRecommend,
    chooseFile,
    clear,
    restoreInput,
    toggleRow,
    selectPage,
    toggleFactor,
    updateTarget,
    updateFactor,
    refreshHealth,
    recommend,
  };
}
