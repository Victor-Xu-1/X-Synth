import { computed, onBeforeUnmount, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { API } from "@/common/api";
import { errorMessage } from "@/common/workspace-errors";
import { UNIFIED_ROUTE_ENDPOINT } from "@/common/unified-route";
import {
  normalizeMode,
  querySeed,
  oneStepCandidate,
  defaultSearchSettings,
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
  const mode = computed(() => normalizeMode(route.query.mode));
  const ready = computed(() =>
    mode.value === "manual" ? workspace.can("retro") : workspace.ready,
  );
  const canSubmit = computed(() =>
    ready.value &&
    !busy.value &&
    mode.value !== "import" &&
    Boolean(structure.value) &&
    !structure.value.pending &&
    typeof draft.smiles === "string" &&
    Boolean(draft.smiles.trim()),
  );
  let lifetime = 0;
  let appliedSeed = null,
    seedError = false;
  watch(
    () => route.query,
    (query) => {
      try {
        const seed = querySeed(query);
        if (!seed) {
          if (appliedSeed !== "") {
            lifetime++;
            busy.value = false;
            draft.settings = defaultSearchSettings();
            appliedSeed = "";
          }
          seedError = false;
          error.value = "";
          return;
        }
        if (seed.key === appliedSeed && !seedError) return;
        lifetime++;
        busy.value = false;
        draft.smiles = seed.smiles;
        draft.name = seed.name;
        draft.settings = seed.settings;
        appliedSeed = seed.key;
        error.value = "";
        seedError = false;
      } catch (e) {
        lifetime++;
        busy.value = false;
        seedError = true;
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
    if (!canSubmit.value || seedError)
      return;
    busy.value = true;
    error.value = "";
    const generation = lifetime;
    const selectedMode = mode.value;
    try {
      const request =
        selectedMode === "auto"
          ? buildWorkbenchRequest({
              smiles: "",
              name: draft.name,
              settings: draft.settings,
            })
          : null;
      const smiles = await structure.value?.read();
      if (!smiles)
        throw new Error(JSON.stringify({ detail: "目标结构为空或无法读取。" }));
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
      const body = {
        ...request,
        smiles: canonical.smiles,
        description: request.description || canonical.smiles,
      };
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
    canSubmit,
    previewOpen,
    previewCandidates,
    changeMode,
    clearStructure,
    submit,
    preview,
    editCandidate,
  };
}
