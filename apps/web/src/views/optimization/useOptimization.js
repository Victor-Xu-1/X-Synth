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
import { exportRecommendationCsv } from "./recommendation-export";

export function useOptimization() {
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
    confirmedMeasurements = ref(false),
    confirmedCandidates = ref(false);
  const health = ref(null),
    healthLoading = ref(true),
    fileLoading = ref(false),
    running = ref(false);
  const result = ref(null),
    error = ref(""),
    activeTab = ref("measurements");
  let revision = 0,
    fileRevision = 0,
    disposed = false;

  function invalidate() {
    revision++;
    result.value = null;
    activeTab.value = "measurements";
    error.value = "";
    confirmedMeasurements.value = false;
    confirmedCandidates.value = false;
  }
  watch([selectedRows, factors, target, batchSize], invalidate, {
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
      !running.value &&
      !fileLoading.value &&
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

  async function chooseFile(file) {
    const ticket = ++fileRevision;
    invalidate();
    table.value = null;
    content.value = "";
    fileName.value = "";
    selectedRows.value = [];
    factors.value = [];
    target.name = "";
    activeTab.value = "measurements";
    fileLoading.value = false;
    if (!file) return;
    if (file.size > LIMITS.bytes) {
      error.value = "CSV 超过 2 MiB，未导入。";
      return;
    }
    fileLoading.value = true;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (disposed || ticket !== fileRevision) return;
      const response = await API.post("/api/v1/optimization/inspect", {
        content: text,
      });
      if (disposed || ticket !== fileRevision) return;
      content.value = text;
      fileName.value = file.name;
      table.value = response;
    } catch (failure) {
      if (!disposed && ticket === fileRevision)
        error.value = API.toErrorObject(
          failure,
          "实测 CSV 读取失败，请核对 UTF-8 文件与表头。",
        ).string_error;
    } finally {
      if (!disposed && ticket === fileRevision) fileLoading.value = false;
    }
  }

  function toggleRow(index) {
    if (selectedRows.value.includes(index))
      selectedRows.value = selectedRows.value.filter(
        (value) => value !== index,
      );
    else if (selectedRows.value.length < LIMITS.measurements)
      selectedRows.value = [...selectedRows.value, index];
  }

  function selectPage(indices, selected) {
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
    if (updates.name)
      factors.value = factors.value.filter(
        (factor) => factor.name !== updates.name,
      );
    Object.assign(target, updates);
  }

  function updateFactor(name, updates) {
    factors.value = factors.value.map((factor) =>
      factor.name === name ? { ...factor, ...updates } : factor,
    );
  }

  async function recommend() {
    if (running.value || health.value?.ready !== true) return;
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
      activeTab.value = "recommendations";
    } catch (failure) {
      if (!disposed && ticket === revision)
        error.value = API.toErrorObject(failure).string_error;
    } finally {
      if (!disposed) running.value = false;
    }
  }

  function download() {
    exportRecommendationCsv(result.value);
  }

  return {
    content,
    fileName,
    table,
    selectedRows,
    factors,
    target,
    batchSize,
    confirmedMeasurements,
    confirmedCandidates,
    health,
    healthLoading,
    fileLoading,
    running,
    result,
    error,
    activeTab,
    count,
    canRecommend,
    chooseFile,
    toggleRow,
    selectPage,
    toggleFactor,
    updateTarget,
    updateFactor,
    refreshHealth,
    recommend,
    download,
  };
}
