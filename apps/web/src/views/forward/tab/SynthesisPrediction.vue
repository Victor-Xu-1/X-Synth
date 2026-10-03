<template>
    <v-container fluid class="pa-0">
        <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6" data-cy="synthesis-prediction-table">
            <v-row align="center" justify="space-between" class="mx-auto my-auto" v-show="!!results.length">
                <v-spacer></v-spacer>
                <v-col cols="auto">
                    <v-btn variant="flat" @click="dialog = true" height="30px" color="primary mx-2" data-cy="synthesis-prediction-export">
                        导出
                    </v-btn>
                </v-col>
            </v-row>

            <v-data-table v-if="!pending && results.length" :headers="headers" :items="results"
                v-show="results.length > 0" :items-per-page="10">
                <template #item.outcome="{ item }">
                    <copy-tooltip :data="item.outcome" :title="'点击复制：' + item.outcome">
                        <smiles-image :smiles="item.outcome" height="80px"></smiles-image>
                    </copy-tooltip>
                </template>
                <template #item.prob="{ item }">
                    {{ item.prob.toFixed(4) }}
                </template>
                <template #item.score="{ item }">
                    {{ item.score.toFixed(3) }}
                </template>
                <template #item.mol_wt="{ item }">
                    {{ item.mol_wt.toFixed(1) }}
                </template>
                <template #item.predict_impurities="{ item, index }">
                    <v-btn variant="tonal" @click="emitGoToImpurity(item.outcome)" :id="'predict-impurities-' + index"
                        title="预测杂质">
                        <v-icon>mdi-arrow-right</v-icon>
                    </v-btn>
                </template>
                <template #item.predict_selectivity="{ item, index }">
                    <v-btn variant="tonal" @click="goToSelectivity(item.outcome)"
                        :id="'predict-regio-selectivities-' + index" title="预测区域选择性">
                        <v-icon>mdi-arrow-right</v-icon>
                    </v-btn>
                </template>
            </v-data-table>
            <v-skeleton-loader v-if="!!pending" class="mx-auto" min-height="100px" type="table"></v-skeleton-loader>
            <v-row align="center" justify="space-between" class="mx-auto my-3">
                <v-alert border="start" type="info" variant="tonal" density="compact" :title="contextTitle">
                    <p v-for="(block, i) in contextBlocks" :key="i" :class="{ 'mt-1': i > 0 }">
                        <template v-for="(text, j) in block.texts" :key="j">
                            {{ text }}<br v-if="j < block.texts.length - 1" />
                        </template>
                        <a v-if="block.ref"
                            class="text-decoration-none text-primary font-weight-medium d-inline-flex align-center"
                            :href="block.ref.url" target="_blank">
                            &nbsp;({{ block.ref.text }} <v-icon size="x-small">mdi-open-in-new</v-icon>)
                        </a>
                    </p>
                </v-alert>
            </v-row>

            <v-row v-if="!pending && results.length === 0" cols="12" class="pa-0 mt-4">
                <v-col>
                    <div class="d-flex flex-column align-center justify-center text-center">
                        <img src="@/assets/emptyForwardSyn.svg" :width="400" class="mb-3" cover />
                        <h2>暂无结果</h2>
                        <p class="text-body-1">请在上方输入反应后生成正向产物预测。</p>
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
                        <v-btn color="primary" text @click="emitDownloadForward()">保存</v-btn>
                    </v-card-actions>
                </v-card>
            </v-dialog>
        </v-sheet>
    </v-container>
</template>

<script setup>
import SmilesImage from "@/components/SmilesImage.vue";
import { ref, computed, onMounted } from 'vue'
import CopyTooltip from "@/components/CopyTooltip";
import { API } from "@/common/api";

let _contextOverviewCache = null

const contextOverview = ref('')

onMounted(() => {
    if (_contextOverviewCache) {
        contextOverview.value = _contextOverviewCache
        return
    }
    API.get('/api/tooltip/forward/forward-overview')
        .then(data => {
            _contextOverviewCache = data
            contextOverview.value = data
        })
})

const contextTitle = computed(() => {
    const lines = contextOverview.value.split('\n')
    return lines[0] ? '正向产物预测说明' : ''
})

const contextBlocks = computed(() => {
    const lines = contextOverview.value.split('\n').filter(l => l.trim())
    if (lines.length) {
        return [{
            texts: [
                '根据输入反应物、试剂和条件，模型会预测可能主产物并给出概率或评分。',
                '结果用于候选筛选，仍需要结合反应类型、底物适用性和实验验证判断。'
            ],
            ref: null
        }]
    }
    const blocks = []
    let current = { texts: [], ref: null }
    let i = 1 // skip title (first line)
    while (i < lines.length) {
        const next = lines[i + 1]
        if (next && next.startsWith('https://')) {
            current.ref = { text: lines[i], url: next }
            blocks.push(current)
            current = { texts: [], ref: null }
            i += 2
        } else {
            current.texts.push(lines[i])
            i++
        }
    }
    if (current.texts.length || current.ref) blocks.push(current)
    return blocks
})

const dialog = ref(false)
const filename = ref('forward.csv')

const { results, pending } = defineProps({
    results: {
        type: Array,
        default: () => []
    },
    pending: {
        type: Number,
        default: 0
    },
})

const headers = ref([
    { key: 'rank', title: '排序', align: 'center', },
    { key: 'outcome', title: '产物', align: 'center' },
    { key: 'prob', title: '概率', align: 'center' },
    { key: 'score', title: '最高评分', align: 'center' },
    { key: 'mol_wt', title: '分子量', align: 'center' },
    { key: 'predict_impurities', title: '预测杂质', align: 'center', },
    { key: 'predict_selectivity', title: '预测区域选择性', align: 'center', }
])

const emits = defineEmits(['download-forward', 'go-to-impurities', 'go-to-selectivity', 'update:filename'])

const emitDownloadForward = () => {
    emits('download-forward')
    dialog.value = false
}

const emitGoToImpurity = (index) => {
    emits('go-to-impurities', index);
}

const goToSelectivity = (index) => {
    emits('go-to-selectivity', index);
}

const updateFilename = (newFilename) => {
    emits('update:filename', newFilename);
};


</script>
