import { defineStore } from "pinia";
import { defaultSearchSettings } from "@/common/workbench-model";

// Session-only drafts: molecular inputs are not persisted in browser storage.
export const useRouteWorkbenchStore = defineStore("route-workbench", {
  state: () => ({
    smiles: "",
    name: "",
    settings: defaultSearchSettings(),
    manual: { model: "pistachio", count: 1000, threshold: 0.75 },
    manualResult: null,
  }),
});
