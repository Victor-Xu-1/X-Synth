/**
 * plugins/resultstoreloader.js
 *
 */

import { useResultsStore } from "@/store/results";

export async function loadResultStore() {
  const resultsStore = useResultsStore();
  if (window.Cypress) {
    window.resultsStore = resultsStore;
  }
}
