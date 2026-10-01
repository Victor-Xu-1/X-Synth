<template>
    <v-container fluid class="pa-0">
        <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6" data-cy="regioselectivity-table">
            <v-row align="center" justify="space-between" class="mx-auto my-auto" v-show="!!results.length">
                <v-spacer></v-spacer>
                <v-col cols="auto">
                    <v-btn variant="flat" @click="dialog = true" height="30px" color="primary mx-2" data-cy="regioselectivity-export">
                        导出
                    </v-btn>
                </v-col>
            </v-row>

            <v-data-table v-if="!pending && results.length" :headers="headers" :items="results" :items-per-page="10">
                <template #item.smiles="{ item }">
                    <copy-tooltip :data="item.smiles" :title="'点击复制：' + item.smiles">
                        <smiles-image :smiles="item.smiles" max-height="125px"></smiles-image>
                    </copy-tooltip>
                </template>
                <template #item.prob="{ item }">
                    {{ item.prob.toFixed(4) }}
                </template>
            </v-data-table>

            <v-skeleton-loader v-if="!!pending" class="mx-auto my-auto" min-height="80px" type="table">
            </v-skeleton-loader>

            <v-row align="center" justify="space-between" class="mx-auto my-3">
                <v-alert border="start" type="info" variant="tonal" density="compact" title="模型说明">
                    <p>
                        预测区域选择性反应的可能产物位点。QM-GNN 模型结合 WLN 图编码和预测量子描述符，用于多任务神经网络推断。
                        <a class="text-decoration-none text-primary font-weight-medium d-inline-flex align-center"
                            href="https://doi.org/10.1039/D0SC04823B">(Chem. Sci., 2021, 12, 2198-2208 <v-icon
                                size="x-small">mdi-open-in-new</v-icon>)</a>
                    </p>
                </v-alert>
            </v-row>

            <v-row v-if="!pending && results.length === 0" cols="12" class="pa-0 mt-4">
                <v-col>
                    <div class="d-flex flex-column align-center justify-center text-center">
                        <img src="@/assets/emptyForwardSyn.svg" :width="400" class="mb-3" cover />
                        <h2>暂无结果</h2>
                        <p class="text-body-1">请在上方输入反应后生成区域选择性预测。</p>
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
                        <v-btn color="primary" text @click="emitDownloadSelectivity()">保存</v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
        </v-sheet>
    </v-container>
</template>


<script setup>
import { ref } from "vue";
import SmilesImage from "@/components/SmilesImage.vue";
import CopyTooltip from "@/components/CopyTooltip";

const dialog = ref(false)
const filename = ref('selectivity.csv')

const { results, pending } = defineProps({
    results: {
        type: Array,
        default: () => [],
    },
    pending: {
        type: Number,
        default: 0
    },
})

const headers = ref([
    { key: 'rank', title: '排序', align: 'center', },
    { key: 'smiles', title: '产物', align: 'center', },
    { key: 'prob', title: '概率', align: 'center', },
])

const emits = defineEmits(['download-selectivity', 'update:filename'])

const emitDownloadSelectivity = () => {
    emits('download-selectivity');
    dialog.value = false;
}

const updateFilename = (newFilename) => {
    emits('update:filename', newFilename);
};


</script>
