import { defineStore } from "pinia";
import { API } from "@/common/api";

export const useConfigStore = defineStore("config", {
  state: () => ({
    envs: {},
  }),
  actions: {
    async init() {
      try {
        const response = await API.get("/api/frontend-config/get-all-config", null, false);
        this.envs = {}
        this.envs = response.reverse().reduce((acc, { key, value }) => {
          acc[key] = value;
          return acc;
        }, {});
      } catch (error) {
        console.error("Failed to initialize config:", error);
      }
    },
  },
});
