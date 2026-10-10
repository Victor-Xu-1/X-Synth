import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { UNIFIED_ROUTE_ENDPOINT } from "@/common/unified-route";
import {
  normalizeMode,
  querySeed,
  oneStepCandidate,
  buildWorkbenchRequest,
} from "@/common/workbench-model";
import { expandMolecule } from "@/common/one-step";
import { cleanGraph, graphFromCandidate } from "@/common/route-graph";
import { useRouteWorkbenchStore } from "@/store/route-workbench";
import { useWorkspaceStore } from "@/store/workspace";

export function useRouteWorkbench() {
  const route = useRoute(),
    router = useRouter();
  const draft = useRouteWorkbenchStore(),
    workspace = useWorkspaceStore();
  const structure = ref(null),
    busy = ref(false),
    error = ref("");
  const previewOpen = ref(false),
    previewCandidates = ref([]);
  const seedError = ref(false);
  const readingStructure = ref(false);
  let activeStructureRead = null;
  const structureSmiles = computed({
    get: () => draft.smiles,
    set: (value) => {
      if (!activeStructureRead) draft.smiles = value;
      else if (activeStructureRead.current()) {
        if (activeStructureRead.request)
          draft.applyManualRead(activeStructureRead.request, value);
        else draft.smiles = value;
      }
    },
  });
  const mode = computed(() => normalizeMode(route.query.mode));
  const ready = computed(() =>
    mode.value === "manual" ? workspace.can("retro") : workspace.ready,
  );
  const canSubmit = computed(() =>
    ready.value &&
    !seedError.value &&
    !busy.value &&
    !readingStructure.value &&
    mode.value !== "import" &&
    Boolean(structure.value) &&
    !structure.value.pending &&
    typeof draft.smiles === "string" &&
    Boolean(draft.smiles.trim()),
  );
  const canCompareManual = computed(() =>
    mode.value === "manual" &&
    Boolean(draft.manualResult) &&
    Boolean(structure.value) &&
    !structure.value.pending &&
    !busy.value &&
    !readingStructure.value &&
    !seedError.value,
  );
  let lifetime = 0;
  watch(
    () => route.query,
    (query) => {
      if (route.path !== "/") return;
      try {
        const seed = querySeed(query);
        const intent = window.history.state?.xSynthSearchIntent;
        const changed = draft.applySeed(seed, { force: seedError.value,
          intent: typeof intent === "string" && intent.length <= 128 ? intent : "" });
        if (changed) { lifetime++; busy.value = false; }
        error.value = "";
        seedError.value = false;
      } catch (e) {
        lifetime++;
        busy.value = false;
        seedError.value = true;
        error.value = errorMessage(e, "任务参数无法读取。");
      }
    },
    { immediate: true, flush: "sync" },
  );
  watch(
    mode,
    () => {
      lifetime++;
      busy.value = false;
      previewOpen.value = false;
    },
    { flush: "sync" },
  );
  watch(
    [() => draft.manualResult, canCompareManual],
    () => {
      previewOpen.value = false;
      previewCandidates.value = [];
    },
    { flush: "sync" },
  );
  watch(
    () => structure.value?.pending,
    (pending) => {
      if (pending && !busy.value) draft.invalidateManual();
    },
    { flush: "sync" },
  );
  function showManualInput() {
    if (!busy.value && !readingStructure.value) draft.manualView = "input";
  }
  function showManualComparison() {
    if (canCompareManual.value) draft.manualView = "comparison";
  }
  function changeMode(value) {
    if (busy.value || readingStructure.value) return;
    error.value = "";
    return router.replace({
      path: "/",
      query: { ...route.query, mode: normalizeMode(value) },
    });
  }
  async function clearStructure() {
    if (busy.value || readingStructure.value) return;
    error.value = "";
    const generation = lifetime,
      revision = draft.manualRevision;
    try {
      await structure.value?.clear();
      if (generation === lifetime && revision === draft.manualRevision)
        draft.smiles = "";
    } catch (e) {
      if (generation === lifetime && revision === draft.manualRevision)
        error.value = errorMessage(e, "结构清空失败，请检查画板。");
    }
  }
  async function submit() {
    if (!canSubmit.value) return;
    const generation = lifetime;
    const selectedMode = mode.value;
    const manualRequest =
      selectedMode === "manual" ? draft.beginManualRequest() : null;
    const current = () =>
      generation === lifetime &&
      (!manualRequest || manualRequest.revision === draft.manualRevision);
    busy.value = true;
    error.value = "";
    try {
      const request =
        selectedMode === "auto"
          ? buildWorkbenchRequest({
              smiles: "",
              name: draft.name,
              settings: draft.settings,
            })
          : null;
      let smiles;
      readingStructure.value = true;
      activeStructureRead = { request: manualRequest, current };
      try {
        smiles = await structure.value?.read();
      } finally {
        activeStructureRead = null;
        readingStructure.value = false;
      }
      if (!smiles)
        throw new Error(JSON.stringify({ detail: "目标结构为空或无法读取。" }));
      if (generation !== lifetime) return;
      if (selectedMode === "manual") {
        if (!current()) {
          error.value = "目标或参数已更新，请重新生成候选。";
          return;
        }
        const result = await expandMolecule(API, {
          smiles,
          ...manualRequest.settings,
        });
        if (current()) draft.publishManualResult(manualRequest, result);
        return;
      }
      const canonical = await API.post("/api/v1/structure/validate", {
        smiles,
      });
      if (generation !== lifetime) return;
      const body = {
        ...request,
        smiles: canonical.smiles,
        description: request.description || canonical.smiles,
      };
      const result = await API.post(UNIFIED_ROUTE_ENDPOINT, body);
      if (generation === lifetime)
        await router.push(`/results/${result.job_id}`);
    } catch (e) {
      if (current())
        error.value = errorMessage(e, "任务提交失败。");
    } finally {
      if (generation === lifetime) busy.value = false;
    }
  }
  function currentCandidate(index) {
    if (!canCompareManual.value)
      throw new Error(JSON.stringify({
        detail: "候选已失效或结构尚未确认，请重新生成候选。",
      }));
    return oneStepCandidate(draft.manualResult, index);
  }
  function preview(index) {
    try {
      previewCandidates.value = [currentCandidate(index)];
      previewOpen.value = true;
    } catch (e) {
      error.value = errorMessage(e, "候选无法预览，请重新生成候选。");
    }
  }
  async function editCandidate(index) {
    if (busy.value || readingStructure.value) return;
    error.value = "";
    const generation = lifetime,
      revision = draft.manualRevision;
    try {
      const candidate = currentCandidate(index);
      busy.value = true;
      const value = await API.post("/api/v1/route-documents", {
        title: `一步候选 ${index + 1}`,
        graph: cleanGraph(graphFromCandidate(candidate)),
      });
      if (generation === lifetime && revision === draft.manualRevision)
        await router.push(`/editor/${value.id}`);
    } catch (e) {
      if (generation === lifetime && revision === draft.manualRevision)
        error.value = errorMessage(e, "候选路线打开失败。");
    } finally {
      if (generation === lifetime) busy.value = false;
    }
  }
  onBeforeUnmount(() => lifetime++);
  onBeforeRouteLeave(async () => {
    if (!busy.value && !readingStructure.value && mode.value !== "import")
      await structure.value?.capture();
  });
  return {
    draft,
    workspace,
    structure,
    structureSmiles,
    readingStructure,
    busy,
    error,
    mode,
    ready,
    canSubmit,
    canCompareManual,
    previewOpen,
    previewCandidates,
    changeMode,
    showManualInput,
    showManualComparison,
    clearStructure,
    submit,
    preview,
    editCandidate,
  };
}
