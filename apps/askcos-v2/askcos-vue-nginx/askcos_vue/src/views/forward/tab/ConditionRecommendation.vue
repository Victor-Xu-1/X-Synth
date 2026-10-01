<template>
    <v-container fluid class="pa-0">
        <v-sheet elevation="2" rounded="lg" width="100%" class="pa-6" data-cy="forward-condition-recommendation-table">
            <v-row align="center" justify="space-between" class="ma-auto" v-show="!!results.length">
                <v-col>
                    <p v-if="!!score">反应评分：{{ score.toFixed(3) }}</p>
                </v-col>
                <v-spacer></v-spacer>
                <v-col cols="auto">
                    <v-btn variant="flat" @click="handleClick" :disabled="evaluating" height="30px" data-cy="cond-rec-get-reaction-score"
                        color="primary mx-2">
                        获取反应评分
                    </v-btn>
                </v-col>
            </v-row>

            <v-data-table class="mx-auto my-auto mt-3" v-if="models === 'neuralnetwork' && !pending && results.length"
                :headers="headers" :items="results" v-show="results.length > 0" :items-per-page="10">
                <template v-slot:item.index="{ index }">
                    {{ index + 1 }}
                </template>
                <template v-slot:item.evaluation="{ item }">
                    <td class="text-center">
                        <v-progress-circular indeterminate
                            v-if="pendingRank > 0 && item.evaluation === undefined"></v-progress-circular>

                        <span v-else-if="item.evaluation">
                            <v-icon>mdi-check</v-icon>（排序：{{ item.evaluation }}）
                        </span>

                        <span v-else-if="item.evaluation !== undefined && !item.evaluation">
                            <v-icon>mdi-close</v-icon>（排序：不适用）
                        </span>
                    </td>
                </template>
                <template v-slot:item.solvent_score="{ item }">
                    <v-chip :color="getColor(item.solvent_score)" v-if="item.solvent_score">
                        {{ item.solvent_score }}
                    </v-chip>
                    <div v-else>
                        无
                    </div>
                </template>
                <template #item.reagent="{ item }">
                    <template v-if="item.reagent">
                        <copy-tooltip :data="item.reagent" :title="'点击复制：' + item.reagent">
                            <smiles-image :smiles="item.reagent" height="80px"></smiles-image>
                        </copy-tooltip>
                    </template>
                    <div v-else>
                        无
                    </div>
                </template>
                <template #item.solvent="{ item }">
                    <template v-if="item.solvent">
                        <copy-tooltip :data="item.solvent" :title="'点击复制：' + item.solvent">
                            <smiles-image :smiles="item.solvent" height="80px"></smiles-image>
                        </copy-tooltip>
                    </template>
                    <div v-else>
                        无
                    </div>
                </template>
                <template #item.temperature="{ item }">
                    {{ Math.round(item.temperature) }} &deg;C
                </template>
                <template #item.catalyst="{ item }">
                    <div class="text-center">
                        <template v-if="!!item.catalyst || !!item.catalyst_name_only">
                            <copy-tooltip :data="item.catalyst" :title="'点击复制：' + item.catalyst">
                                <smiles-image v-if="!!item.catalyst" :smiles="item.catalyst"></smiles-image>
                            </copy-tooltip>
                        </template>
                        <template v-else>
                            无
                        </template>
                    </div>
                </template>
                <template #item.predict="{ index }">
                    <v-btn variant="tonal" @click="emitGoToForward(index)" :id="'predict-conditions-' + index"
                        title="带入条件预测产物">
                        <v-icon>mdi-arrow-right</v-icon>
                    </v-btn>
                </template>
            </v-data-table>

            <v-data-table class="mx-auto my-auto" v-else-if="models === 'neuralnetworkv2' && !pending && results.length"
                :headers="headersAlt" :items="results" v-show="results.length > 0" :items-per-page="10">
                <template v-slot:item.index="{ index }">
                    {{ index + 1 }}
                </template>
                <template v-slot:item.evaluation="{ item }">
                    <td class="text-center">
                        <v-progress-circular indeterminate
                            v-if="pendingRank > 0 && item.evaluation === undefined"></v-progress-circular>

                        <span v-else-if="item.evaluation">
                            <v-icon>mdi-check</v-icon>（排序：{{ item.evaluation }}）
                        </span>

                        <span v-else-if="item.evaluation !== undefined && !item.evaluation">
                            <v-icon>mdi-close</v-icon>（排序：不适用）
                        </span>
                    </td>
                </template>
                <template #item.reactants="{ item }">
                    <div v-for="(amount, rct) in item.reactants" class="text-center my-2" :key="rct">
                        <copy-tooltip :data="rct" :title="'点击复制：' + rct">
                            <smiles-image :smiles="rct" max-height="80px"></smiles-image>
                        </copy-tooltip>
                        ({{ Number.isFinite(amount) ? amount.toFixed(2) : 'N/A' }})
                    </div>
                </template>
                <template #item.temperature="{ item }">
                    {{ Math.round(item.temperature) }} &deg;C
                </template>
                <template #item.score="{ item }">
                    <v-chip :color="getColor(item.score)" v-if="item.score !== undefined">
                        {{ item.score.toFixed ? item.score.toFixed(3) : item.score }}
                    </v-chip>
                    <div v-else>
                        无
                    </div>
                </template>
                <template v-slot:item.reagents="{ item }">
                    <div v-if="!!item.reagents">
                        <div class="text-center my-2" v-for="(amount, rgt) in item.reagents" :key="rgt">
                            <copy-tooltip :data="rgt" :title="'点击复制：' + rgt">
                                <smiles-image :smiles="rgt" max-height="80px"></smiles-image>
                            </copy-tooltip>
                            ({{ Number.isFinite(amount) ? ((amount > 0.01) ? amount.toFixed(2) : amount.toExponential(2)) : 'N/A' }})
                        </div>
                    </div>
                    <span v-else class="text-center">无</span>
                </template>
                <template #item.predict="{ index }">
                    <v-btn variant="tonal" @click="emitGoToForward(index)" :id="'predict-conditions-' + index"
                        title="带入条件预测产物">
                        <v-icon>mdi-arrow-right</v-icon>
                    </v-btn>
                </template>
            </v-data-table>


            <v-skeleton-loader v-else-if="!!pending" class="mx-auto my-auto" min-height="80px" type="table">
            </v-skeleton-loader>

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
                        <p class="text-body-1">请在上方输入反应并生成条件推荐。</p>
                    </div>
                </v-col>
            </v-row>
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
    API.get('/api/tooltip/context/context-overview')
        .then(data => {
            _contextOverviewCache = data
            contextOverview.value = data
        })
})

const contextTitle = computed(() => {
    const lines = contextOverview.value.split('\n')
    return lines[0] ? '条件推荐模型说明' : ''
})

const contextBlocks = computed(() => {
    const lines = contextOverview.value.split('\n').filter(l => l.trim())
    if (lines.length) {
        return [{
            texts: [
                '根据输入反应结构，模型会推荐溶剂、试剂、催化剂和温度等候选条件。',
                '这些结果用于实验方案筛选，仍需要结合文献、底物适用性和安全评估确认。'
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

const { results, models, pending } = defineProps({
    results: {
        type: Array,
        default: () => [],
    },
    models: {
        type: String,
        default: ""
    },
    pending: {
        type: Number,
        default: 0
    },
    pendingRank: {
        type: Number,
        default: 0
    },
    score: {
        type: Number,
        default: 0
    },
    evaluating: {
        type: Boolean,
        default: false
    }
})

const headers = ref([
    { key: 'index', title: '#', align: 'center', },
    // { key: 'evaluation', title: 'Rank', align: 'center', },
    { key: 'solvent', title: '溶剂', align: 'center' },
    { key: 'reagent', title: '试剂', align: 'center' },
    { key: 'catalyst', title: '催化剂', align: 'center', },
    { key: 'temperature', title: '温度', align: 'center', },
    { key: 'solvent_score', title: '溶剂评分', align: 'center', },
    { key: 'predict', title: '带入条件预测', align: 'center' }
])


const headersAlt = ref([
    { key: 'index', title: '#', align: 'center', },
    // { key: 'evaluation', title: 'Rank', align: 'center', },
    { key: 'reactants', title: '反应物（用量）', align: 'center' },
    { key: 'reagents', title: '试剂（用量）', align: 'center', },
    { key: 'temperature', title: '温度', align: 'center', },
    { key: 'score', title: '评分', align: 'center' },
    { key: 'predict', title: '带入条件预测', align: 'center' }
])


const getColor = (score) => {
    if (score === 1) return 'primary'
    else return 'orange'
}

const emits = defineEmits(['go-to-forward', 'evaluate'])

const emitGoToForward = (index) => {
    emits('go-to-forward', index);
}

const handleClick = () => {
    emits('evaluate');
}

</script>
