import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { defaultSearchSettings } from "@/common/workbench-model";

// Session-only drafts: molecular inputs are not persisted in browser storage.
export const useRouteWorkbenchStore = defineStore("route-workbench", () => {
  const smiles = ref(""),
    name = ref("");
  const settings = ref(defaultSearchSettings());
  const manual = ref({ model: "pistachio", count: 1000, threshold: 0.75 });
  const manualResult = ref(null),
    manualContext = ref(null);
  const manualRevision = ref(0),
    manualView = ref("input");
  let applyingManualRead = false;
  let appliedSeed = null;

  function applySeed(seed, { force = false, intent = "" } = {}) {
    const key = JSON.stringify([seed?.key || "", intent]);
    if (!force && key === appliedSeed) return false;
    if (seed) {
      smiles.value = seed.smiles;
      name.value = seed.name;
      settings.value = structuredClone(seed.settings);
    } else if (appliedSeed !== null) settings.value = defaultSearchSettings();
    appliedSeed = key;
    return true;
  }

  function invalidateManual() {
    manualRevision.value++;
    manualResult.value = null;
    manualContext.value = null;
    manualView.value = "input";
  }
  // A value comparison after await cannot detect edits followed by a revert.
  watch(
    smiles,
    () => {
      if (!applyingManualRead) invalidateManual();
    },
    { flush: "sync" },
  );
  watch(
    [
      () => manual.value.model,
      () => manual.value.count,
      () => manual.value.threshold,
    ],
    invalidateManual,
    { flush: "sync" },
  );
  function beginManualRequest() {
    invalidateManual();
    return { revision: manualRevision.value, settings: { ...manual.value } };
  }
  function applyManualRead(request, value) {
    if (request.revision !== manualRevision.value) return false;
    // Only the owned native read may change its text representation without an edit.
    applyingManualRead = true;
    try {
      smiles.value = value;
    } finally {
      applyingManualRead = false;
    }
    return true;
  }
  function publishManualResult(request, result) {
    if (request.revision !== manualRevision.value) return false;
    manualContext.value = { ...request.settings };
    manualResult.value = result;
    manualView.value = "comparison";
    return true;
  }
  return {
    smiles,
    name,
    settings,
    manual,
    manualResult,
    manualContext,
    manualRevision,
    manualView,
    applySeed,
    invalidateManual,
    beginManualRequest,
    applyManualRead,
    publishManualResult,
  };
});
