import { defineStore } from "pinia";

export const useFastapiStore = defineStore("fastapi", {
  state: () => ({
    requestHistory: [],
  }),
  actions: {
    addRequestHistory({ endpoint, method, request, response }) {
      this.requestHistory.push({ endpoint, method, request, response });
    },
    clearRequestHistory() {
      this.requestHistory = [];
    },
  },
});
