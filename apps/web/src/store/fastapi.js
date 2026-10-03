import { defineStore } from "pinia";
import { recordRequest } from "@/common/request-observability";

export const useFastapiStore = defineStore("fastapi", {
  state: () => ({
    requestHistory: [],
  }),
  actions: {
    addRequestHistory({ endpoint, method, request, response }) {
      recordRequest(this, { endpoint, method, request, response });
    },
    clearRequestHistory() {
      this.requestHistory = [];
    },
  },
});
