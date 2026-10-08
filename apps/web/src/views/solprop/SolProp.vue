<template>
  <module-workbench
    title="溶解度与溶剂"
    :modules="modules"
    :active-module="tab"
    @select-module="replaceRoute"
  >
    <template #module="{ value }">
      <SolubilityPredict v-if="value === 'solpred'" />
      <SolventScreen v-else-if="value === 'solscreen'" />
    </template>
  </module-workbench>
</template>

<script setup>
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SolubilityPredict from "@/views/solprop/tabs/SolubilityPredictView";
import SolventScreen from "@/views/solprop/tabs/SolventScreenView";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useWorkspaceStore } from "@/store/workspace";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();
const tabs = ["solpred", "solscreen"];
const tab = computed(() =>
  tabs.includes(route.query.tab) ? route.query.tab : "solpred",
);
const modules = computed(() =>
  [
    {
      value: "solpred",
      title: "溶解度预测",
      disabled: !workspace.can("solubility"),
    },
    {
      value: "solscreen",
      title: "溶剂筛选",
      disabled: !workspace.can("solubility"),
    },
  ],
);

const replaceRoute = (value) => {
  if (!tabs.includes(value) || !workspace.can("solubility")) return;
  router.replace({ path: "/solprop", query: { ...route.query, tab: value } });
};

watch(
  () => route.query.tab,
  (value) => {
    if (value !== undefined && !tabs.includes(value)) {
      router.replace({
        path: "/solprop",
        query: { ...route.query, tab: "solpred" },
      });
    }
  },
  { immediate: true },
);
onMounted(() => workspace.refresh());
</script>
