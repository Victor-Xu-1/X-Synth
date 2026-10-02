<template>
    <v-container fluid class="pa-0">
        <v-sheet elevation="5" rounded="lg" width="100%" class="pa-6" data-cy="impurity-prediction-table">
            <v-row align="center" justify="space-between" class="mx-auto my-auto" v-show="!!results.length">
                <v-col v-if="!!pending">
                    <p><span class="text-body-3 ml-2">进度：{{ progress.message }}</span></p>
                </v-col>

                <v-spacer></v-spacer>
                <v-col cols="auto">
                    <v-btn variant="flat" @click="dialog = true" height="30px" color="primary mx-2" data-cy="impurity-prediction-export">
                        导出
                    </v-btn>
                </v-col>
            </v-row>

            <v-data-table v-if="!pending && results.length" :headers="headers" :items="results" :items-per-page="10">
                <template #item.prd_smiles="{ item }">
                    <copy-tooltip :data="item.prd_smiles" :title="'点击复制：' + item.prd_smiles">
                        <smiles-image :smiles="item.prd_smiles" height="80px">
                        </smiles-image>
                    </copy-tooltip>
                </template>
                <template #item.avg_insp_score="{ item }">
                    {{ item.avg_insp_score.toFixed(3) }}
                </template>
                <template #item.similarity_to_major="{ item }">
                    {{ item.similarity_to_major.toFixed(3) }}
                </template>
                <template #item.prd_mw="{ item }">
                    {{ item.prd_mw.toFixed(3) }}
                </template>
            </v-data-table>


            <v-skeleton-loader v-if="!!pending" class="mx-auto my-auto" min-height="80px" type="table">
            </v-skeleton-loader>

            <v-row align="center" justify="space-between" class="mx-auto my-3">
                <v-alert border="start" type="info" variant="tonal" density="compact" title="模型说明">
                    <p>
                        根据输入反应预测潜在杂质，覆盖少量副产物、过度反应、二聚体、溶剂加合物和部分反应物组合等来源。
                    </p>
                </v-alert>
            </v-row>

            <v-row v-if="!pending && results.length === 0" cols="12" class="pa-0 mt-4">
                <v-col>
                    <div class="d-flex flex-column align-center justify-center text-center">
                        <img src="@/assets/emptyForwardSyn.svg" :width="400" class="mb-3" cover />
                        <h2>暂无结果</h2>
                        <p class="text-body-1">请在上方输入反应后生成潜在杂质预测。</p>
                    </div>
                </v-col>
            </v-row>

            <v-dialog v-model="dialog" max-width="600px" persistent>
                <v-card>
                    <v-card-title class="headline">导出结果</v-card-title>
                    <v-card-text>
                        <v-text-field v-model="filename" @input="updateFilename($event.target.value)"
                            density="comfortable" variant="outlined" placeholder="文件名" hide-details clearable
                            type="string"></v-text-field>
                    </v-card-text>
                    <v-card-actions>
                        <v-spacer></v-spacer>
                        <v-btn color="red darken-1" text @click="dialog = false">取消</v-btn>
                        <v-btn color="primary" text @click="emitDownloadImpurity()">保存</v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
        </v-sheet>
    </v-container>
</template>


<script setup>
import SmilesImage from "@/components/SmilesImage.vue";
import { ref } from 'vue';
import CopyTooltip from "@/components/CopyTooltip";

const dialog = ref(false)
const filename = ref('impurity.csv')


const { results, progress } = defineProps({
    results: {
        type: Array,
        default: () => [],
    },
    pending: {
        type: Number,
        default: 0
    },
    progress: {
        type: Object,
        default: () => ({}),
    },
})

const headers = ref([
    { key: 'no', title: '序号', align: 'center', },
    { key: 'prd_smiles', title: '预测杂质', align: 'center', },
    { key: 'modes_name', title: '可能机理', align: 'center', },
    { key: 'avg_insp_score', title: '检查评分', align: 'center', },
    { key: 'similarity_to_major', title: '主产物相似度', align: 'center', },
    { key: 'prd_mw', title: '分子量', align: 'center', },
])

const emits = defineEmits(['download-impurity', 'update:filename'])

const emitDownloadImpurity = () => {
    emits('download-impurity');
    dialog.value = false;
}

const updateFilename = (newFilename) => {
    emits('update:filename', newFilename);
};

</script>
