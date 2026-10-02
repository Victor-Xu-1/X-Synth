<template>
  <TreeView
    v-if="isRouteTreeDetail"
    ref="treeDetail"
    :tab-active="tab === 'TE'"
    @switch-tab="$event => tab = $event"
  />
  <module-workbench
    v-else
    title="逆合成路线工作台"
    eyebrow="路线设计"
    icon="mdi-source-branch"
    accent="primary"
    description="使用已接入的交互式路线规划、一步逆合成和路线树查看能力，从目标分子生成并浏览候选合成路径。"
    :modules="routeModules"
    :active-module="tab"
    :summary-items="summaryItems"
    @select-module="replaceRoute"
  >
    <v-window v-model="tab" :class="tab === 'IPP' ? 'elevation-2 rounded-lg' : 'elevation-0'" :touch="false">
      <v-window-item value="IPP">
        <NetworkView :tab-active="tab === 'IPP'" @update:treeViewVisible="($event) => treeViewVisible = $event"
          ref="network" />
      </v-window-item>
      <v-window-item value="RP">
        <RetroView />
      </v-window-item>
      <v-window-item value="TE" eager>
        <TreeView ref="treeDetail" :tab-active="tab === 'TE'" @switch-tab="$event => tab = $event" />
      </v-window-item>
    </v-window>
  </module-workbench>
</template>

<script>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import NetworkView from "@/views/network/tabs/NetworkView";
import RetroView from "@/views/network/tabs/RetroView";
import TreeView from "@/views/network/tabs/TreeView";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useResultsStore } from "@/store/results";
import { useConfirm } from 'vuetify-use-dialog';

export default {
  name: "Network",
  components: {
    NetworkView,
    RetroView,
    TreeView,
    ModuleWorkbench
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const resultsStore = useResultsStore();
    const network = ref(null);
    const treeDetail = ref(null);
    const treeViewVisible = ref(false);
    const tab = ref("IPP");
    const createConfirm = useConfirm();
    const isRouteTreeDetail = computed(() => tab.value === "TE" && !!route.query.id);
    const routeModules = computed(() => [
      { value: "IPP", title: "交互式路线规划", subtitle: "从目标结构构建路线网络", icon: "mdi-graph-outline" },
      { value: "RP", title: "一步逆合成", subtitle: "查看单步断键候选", icon: "mdi-debug-step-over" },
      { value: "TE", title: "路线树查看", subtitle: "浏览已保存路线树", icon: "mdi-file-tree", disabled: !treeViewVisible.value },
    ]);
    const summaryItems = [
      { label: "输入", value: "目标分子 SMILES 或绘制结构", icon: "mdi-flask-outline" },
      { label: "搜索", value: "模板相关性和树搜索策略", icon: "mdi-tune-variant" },
      { label: "结果", value: "一步候选、路线网络和树详情", icon: "mdi-file-tree-outline" },
    ];


    const replaceRoute = (tab) => {
      const newPath = { path: '/network', query: { tab: tab, id: route.query.id } }
      router.replace(newPath)
    }

    const loadResultFromURL = async (payload) => {
      await resultsStore.loadResult(payload)
    };

    onMounted(() => {
      treeViewVisible.value = false;
      let urlParams = route.query;
      let urlTab = urlParams.tab;
      if (urlTab) {
        tab.value = urlTab;
      }

      let resultId = urlParams.id;
      if (resultId) {
        treeViewVisible.value = true;
      }
      let numTrees = urlParams.view;
      if (resultId) {
        loadResultFromURL({ resultId: resultId, numTrees: numTrees }).then(
          () => {
            init(tab.value);
          }
        ).catch((e) => {
          createConfirm({ title: "结果加载失败", content: e, dialogProps: { width: "auto" } })
        })
      }
    });

    const init = (tab) => {
      if (tab === "IPP" && network.value) {
        network.value.init();
      } else if (tab === "TE" && treeDetail.value) {
        treeDetail.value.init();
      }
    };

    watch(route, async (newRoute) => {
      if (newRoute.path === '/network') {
        tab.value = newRoute.query.tab
      }
    })


    return {
      replaceRoute,
      treeViewVisible,
      network,
      treeDetail,
      tab,
      isRouteTreeDetail,
      routeModules,
      summaryItems,
    };
  },
};
</script>
