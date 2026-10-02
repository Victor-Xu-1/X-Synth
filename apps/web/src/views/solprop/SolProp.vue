<template>
    <module-workbench
        title="溶解度与溶剂工作台"
        eyebrow="性质预测"
        icon="mdi-water-outline"
        accent="primary"
        description="围绕溶质、溶剂和温度进行溶解度预测与溶剂集合筛选，用于实验方案前的溶剂选择和工艺初筛。"
        :modules="modules"
        :active-module="tab"
        :summary-items="summaryItems"
        @select-module="replaceRoute"
    >
        <v-window v-model="tab" class="elevation-0" :touch="false">
            <v-window-item value="solpred">
                <SolubilityPredict />
            </v-window-item>
            <v-window-item value="solscreen">
                <SolventScreen />
            </v-window-item>
        </v-window>
    </module-workbench>
</template>

<script>
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SolubilityPredict from "@/views/solprop/tabs/SolubilityPredictView";
import SolventScreen from "@/views/solprop/tabs/SolventScreenView";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";

export default {
    name: 'SolProp',
    components: {
        SolubilityPredict,
        SolventScreen,
        ModuleWorkbench,
    },
    setup() {
        const route = useRoute();
        const router = useRouter();
        const tab = ref("solpred");
        const modules = [
            { value: "solpred", title: "溶解度预测", subtitle: "单组溶质/溶剂/温度", icon: "mdi-chart-bell-curve" },
            { value: "solscreen", title: "溶剂筛选", subtitle: "多溶剂和多温度筛选", icon: "mdi-flask-round-bottom-outline" },
        ];
        const summaryItems = [
            { label: "输入", value: "溶质、溶剂、温度", icon: "mdi-login-variant" },
            { label: "输出", value: "溶解度、热力学字段、图表", icon: "mdi-table-chart" },
            { label: "适用", value: "实验前溶剂选择和工艺初筛", icon: "mdi-check-decagram-outline" },
        ];

        const replaceRoute = (tab) => {
            router.replace({ path: '/solprop', query: { tab } })
        }

        onMounted(() => {
            let urlParams = route.query;
            let urlTab = urlParams.tab;
            if (urlTab) {
                tab.value = urlTab;
            }
        });

        watch(route, async (newRoute) => {
            if (newRoute.path === '/solprop') {
                tab.value = newRoute.query.tab || 'solpred'
            }
        })

        return {
            replaceRoute,
            tab,
            modules,
            summaryItems,
        };
    },
}
</script>
