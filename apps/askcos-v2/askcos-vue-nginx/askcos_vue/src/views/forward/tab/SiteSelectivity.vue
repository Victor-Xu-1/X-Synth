<template>
    <v-container fluid class="pa-0">
        <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6" data-cy="site-selectivity-table">
            <v-row class="justify-center my-auto" density="compact" v-if="!pending && siteResults.length">
                <v-col cols="12" md="8" justify-center>
                    <v-text-field label="筛选反应物" density="compact" variant="outlined" hide-details
                        placeholder="按 SMILES 子字符串筛选反应物。" :model-value="resultsQuery"
                        @update:modelValue="($event) => { resultsQuery = $event; emitResultQuery() }"></v-text-field>
                </v-col>
            </v-row>
            <v-row class="justify-center align-center" v-if="!pending && siteResults.length">
                <v-col class="d-flex align-center justify-center" cols="12" md="10">
                    <ketcher-min ref="ketcherMinRef"
                        @change="($event) => { selectedAtoms = $event; emitSiteAtoms() }"></ketcher-min>
                </v-col>
            </v-row>

            <v-data-table v-if="!pending && siteResults.length" :headers="headers" :items="results" class="my-3"
                :items-per-page="5">
                <template v-slot:item.task="{ item }">
                    <smiles-image :smiles="item.task"></smiles-image>
                </template>
                <template v-slot:item.smiles="{ item }">
                    <smiles-image :smiles="item.smiles" :reacting-atoms="item.atom_scores"
                        :highlight=true></smiles-image>
                </template>
                <template v-slot:item.references="{ item }">
                    <div v-if="item.references === undefined">
                        <v-btn outlined variant="tonal" @click="emitgetSitesRefs(item.index)" data-cy="get-training-reaction-ids">
                            获取训练反应 ID
                        </v-btn>
                    </div>
                    <div v-else>
                        <p class="my-3">{{ item.references.length }} 条训练反应</p>
                        <copy-tooltip :data="item.references.join('; ')" class="my-0">
                            <v-btn variant="outlined" data-cy="copy-all-reaction-ids">
                                <v-icon>mdi-content-copy</v-icon> 复制全部反应 ID
                            </v-btn>
                        </copy-tooltip>
                        <v-btn variant="outlined" class="my-2" :href="createReaxysUrl(item.references.slice(0, 50))"
                            data-cy="find-first-50-in-reaxys">
                            <v-icon>mdi-open-in-new</v-icon> 在 Reaxys 中查找前 50 条
                        </v-btn>
                        <br>
                        <v-btn variant="outlined" class="mb-3" @click="emitDownloadSitesRefs(item)"
                            data-cy="export-all-as-reaxys-query">
                            <v-icon>mdi-download</v-icon> 导出为 Reaxys 查询
                        </v-btn>
                    </div>
                </template>
            </v-data-table>

            <v-skeleton-loader v-if="!!pending" class="mx-auto" min-height="100px" type="table"></v-skeleton-loader>

            <v-row align="center" justify="space-between" class="mx-auto my-3">
                <v-alert border="start" type="info" variant="tonal" density="compact" title="模型说明">
                    <p>
                        使用带 WLN 图编码的多任务神经网络，预测芳香 C-H 官能团化反应的可能反应位点。
                        <a class="text-decoration-none text-primary font-weight-medium d-inline-flex align-center"
                            href="https://doi.org/10.1039/D0RE00071J">(React. Chem. Eng., 2020, 5,
                            896-902 <v-icon size="x-small">mdi-open-in-new</v-icon>)</a>
                    </p>
                </v-alert>
            </v-row>

            <v-row v-if="!pending && results.length === 0" cols="12" class="pa-0 mt-4">
                <v-col>
                    <div class="d-flex flex-column align-center justify-center text-center">
                        <img src="@/assets/emptyForwardSyn.svg" :width="400" class="mb-3" cover />
                        <h2>暂无结果</h2>
                        <p class="text-body-1">请在上方输入芳香底物后生成位点选择性预测。</p>
                    </div>
                </v-col>
            </v-row>
        </v-sheet>
    </v-container>
</template>


<script setup>
import SmilesImage from "@/components/SmilesImage.vue";
import KetcherMin from "@/components/KetcherMin.vue";
import { ref } from 'vue'
import { createReaxysUrl } from "@/common/reaxys";
import CopyTooltip from "@/components/CopyTooltip";

const resultsQuery = ref('')
const ketcherMinRef = ref(null)
const selectedAtoms = ref([])

const { results, pending } = defineProps({
    results: {
        type: Array,
        default: () => [],
    },
    pending: {
        type: Number,
        default: 0
    },
    siteResults: {
        type: Array,
        default: () => [],
    }
})

const emits = defineEmits(['get-sites-refs', 'download-sites-refs', 'update-result-query', 'update-selected-atoms'])

const emitgetSitesRefs = async (index) => {
    emits('get-sites-refs', index)
}

const emitDownloadSitesRefs = (result) => {
    emits('download-sites-refs', result)
}

const emitResultQuery = () => {
    emits("update-result-query", resultsQuery.value)
}

const emitSiteAtoms = () => {
    emits("update-selected-atoms", selectedAtoms.value)
}

const headers = ref([
    { key: 'task', title: '反应物', align: 'center' },
    { key: 'smiles', title: '位点', align: 'center', },
    { key: 'references', title: '参考反应', align: 'center', width: "500px" },

])

defineExpose({
    ketcherMinRef
})
</script>
