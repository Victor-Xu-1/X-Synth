import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import {
  UNIFIED_ROUTE_ENDPOINT,
  buildUnifiedRouteRequestBody,
} from "@/common/unified-route";
import {
  normalizeMode,
  querySeed,
  oneStepCandidate,
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
  const mode = computed(() => normalizeMode(route.query.mode));
  const ready = computed(() =>
    mode.value === "manual" ? workspace.can("retro") : workspace.ready,
  );
  let lifetime = 0;
  let appliedSeed = "";
  watch(
    () => route.query,
    (query) => {
      try {
        const seed = querySeed(query);
        if (!seed || seed.key === appliedSeed) return;
        draft.smiles = seed.smiles;
        draft.name = seed.name;
        if (seed.settings) draft.settings = seed.settings;
        appliedSeed = seed.key;
        error.value = "";
      } catch (e) {
        error.value = errorMessage(e, "任务参数无法读取。");
      }
    },
    { immediate: true },
  );
  function changeMode(value) {
    if (busy.value) return;
    error.value = "";
    return router.replace({
      path: "/",
      query: { ...route.query, mode: normalizeMode(value) },
    });
  }
  async function clearStructure() {
    if (busy.value) return;
    error.value = "";
    await structure.value?.clear();
    draft.smiles = "";
  }
  async function submit() {
    if (busy.value || !ready.value || mode.value === "import") return;
    busy.value = true;
    error.value = "";
    const generation = lifetime;
    const selectedMode = mode.value;
    try {
      const smiles = await structure.value?.read();
      if (!smiles) throw new Error("目标结构为空或无法读取。");
      if (generation !== lifetime) return;
      if (selectedMode === "manual") {
        const result = await expandMolecule(API, { smiles, ...draft.manual });
        if (generation === lifetime) draft.manualResult = result;
        return;
      }
      const canonical = await API.post("/api/v1/structure/validate", {
        smiles,
      });
      if (generation !== lifetime) return;
      const body = buildUnifiedRouteRequestBody({
        smiles: canonical.smiles,
        description: draft.name.trim() || canonical.smiles,
        expansion_time: draft.settings.minutes * 60,
        max_routes: draft.settings.maxRoutes,
        tuning: draft.settings.tuning,
      });
      const result = await API.post(UNIFIED_ROUTE_ENDPOINT, body);
      if (generation === lifetime)
        await router.push(`/results/${result.job_id}`);
    } catch (e) {
      if (generation === lifetime)
        error.value = errorMessage(e, "任务提交失败。");
    } finally {
      if (generation === lifetime) busy.value = false;
    }
  }
  function preview(index) {
    previewCandidates.value = [oneStepCandidate(draft.manualResult, index)];
    previewOpen.value = true;
  }
  async function editCandidate(index) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    const generation = lifetime;
    try {
      const candidate = oneStepCandidate(draft.manualResult, index);
      const value = await API.post("/api/v1/route-documents", {
        title: `一步候选 ${index + 1}`,
        graph: cleanGraph(graphFromCandidate(candidate)),
      });
      if (generation === lifetime) await router.push(`/editor/${value.id}`);
    } catch (e) {
      if (generation === lifetime)
        error.value = errorMessage(e, "候选路线打开失败。");
    } finally {
      if (generation === lifetime) busy.value = false;
    }
  }
  onBeforeUnmount(() => lifetime++);
  onBeforeRouteLeave(async () => {
    if (!busy.value && mode.value !== "import")
      await structure.value?.capture();
  });
  return {
    draft,
    workspace,
    structure,
    busy,
    error,
    mode,
    ready,
    previewOpen,
    previewCandidates,
    changeMode,
    clearStructure,
    submit,
    preview,
    editCandidate,
  };
}
