<template>
    <v-container fluid>
        <v-row class="justify-center align-center">
            <v-col cols="12" md="6" data-cy="retro-left-panel">
                <v-sheet elevation="2" class="pa-5" rounded="lg">
                    <v-text-field id="retro-target" v-model="target" density="compact" variant="outlined" label="目标结构"
                        placeholder="SMILES" type="text" clearable hide-details class="target-input" rounded="pill">
                        <template v-slot:prepend-inner v-if="enableResolver">
                            <v-btn icon="mdi mdi-server" :class="allowResolve ? 'text-primary' : 'text-grey'"
                                @click="toggleResolver" variant="flat">
                            </v-btn>
                        </template>
                        <template v-slot:append-inner>
                            <draw-button v-model:smiles="target" />
                        </template>
                    </v-text-field>
                    <smiles-image :smiles="target" height="100px" v-if="!!target" class="my-3"></smiles-image>
                    <v-select id="retro-model-0" label="模型" :items="models" item-title="title" item-value="value"
                        v-model="settings.model" variant="outlined" density="compact" hide-details class="my-3"
                        data-cy="retro-model" rounded="pill"></v-select>
                    <v-select id="retro-training-set-0" label="训练集" :items="trainingSets"
                        item-title="title" item-value="value" v-model="settings.trainingSet" variant="outlined"
                        density="compact" hide-details class="my-3" data-cy="retro-training-set"
                        rounded="pill"></v-select>
                    <div class="text-center">
                        <v-btn variant="flat" color="primary" @click="runRetro()" :disabled="!target || !validSmiles"
                            data-cy="retro-submit">提交</v-btn>
                        <v-btn variant="outlined" class="ml-2" :disabled="!target || !validSmiles"
                            @click="showAdvSettings = true" data-cy="retro-advanced">高级设置</v-btn>
                    </div>
                </v-sheet>
            </v-col>
            <v-col cols="12" md="6" data-cy="retro-right-panel">
                <v-sheet elevation="2" v-if="Object.keys(predictions).length" rounded="lg">
                    <v-carousel height="300" hide-delimiters :continuous="false" v-model="carouselSlide">
                        <v-carousel-item v-for="(item, index) in predictions" :key="index">
                            <div class="mx-auto d-flex justify-center align-center" style="height:100%">
                                <v-card width="400" variant="outlined" :id="'prediction-card-' + (index)">
                                    <template v-slot:title>
                                        <div class="d-flex justify-space-between align-center">
                                            <div v-if="item.edit" style="width:100%" class="mr-2 mt-2 mb-2">
                                                <v-text-field label="标签" v-model="labels[index]" variant="outlined"
                                                    :id="'retro-pred-card-type-' + (index)" @blur="item.edit = false"
                                                    @keyup.enter="item.edit = false" hide-details></v-text-field>
                                            </div>
                                            <div v-else class="d-flex align-items-baseline ml-3">
                                                <h4>{{ labels[index] }}</h4>
                                                <v-icon size="small" icon="mdi mdi-pencil" @click="item.edit = true"
                                                    :data-cy="'retro-pred-card-edit-button-' + (index)"
                                                    class="ml-2"></v-icon>
                                            </div>
                                            <v-progress-circular v-if="item.loading" color="primary" indeterminate
                                                :width="5"></v-progress-circular>
                                        </div>
                                    </template>
                                    <v-card-text>
                                        <v-table>
                                            <thead>
                                                <tr>
                                                    <th class="text-left">
                                                        模型
                                                    </th>
                                                    <th class="text-left">
                                                        训练集
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td>{{ item.model }}</td>
                                                    <td>{{ item.trainingSet }}</td>
                                                </tr>
                                            </tbody>
                                        </v-table>
                                        <div class="d-flex justify-space-between align-center">
                                            <v-checkbox-btn v-model="item.show" label="在表格中显示"
                                                :data-cy="'retro-pred-card-show-in-table-' + (index)"></v-checkbox-btn>
                                            <v-btn v-if="item.model === 'template_relevance'" variant="plain"
                                                :data-cy="'retro-pred-card-view-settings-' + (index)"
                                                @click="viewSettings(item)">查看全部设置</v-btn>
                                            <v-btn variant="tonal" density="compact" color="error"
                                                :data-cy="'retro-pred-card-delete-' + (index)"
                                                @click="deleteResult(index)" icon="mdi-delete"></v-btn>
                                        </div>
                                    </v-card-text>
                                </v-card>
                            </div>
                        </v-carousel-item>
                    </v-carousel>
                    <div class="d-flex justify-end pa-3 ">
                        <v-btn variant="flat" color="primary" class="justify-end mr-2"
                            data-cy="retro-see-all-predictions" @click="allPredictionsDialog = true">查看全部预测</v-btn>
                        <v-btn variant="tonal" class="justify-end" @click="clear()" data-cy="retro-clear-all">清空全部</v-btn>
                    </div>
                </v-sheet>
                <v-sheet v-else elevation="2" class="d-flex justify-center align-center flex-column text-center pa-5"
                    rounded="lg">
                    <v-img :width="400" cover :src="emptyVoid" class="mb-3"></v-img>
                    <h2>暂无预测</h2>
                    <p class="text-body-1">请在左侧输入目标结构并运行一步逆合成。</p>
                </v-sheet>
            </v-col>
        </v-row>
        <v-row v-if="Object.keys(results).length" data-cy="retro-results">
            <v-col cols="12">
                <v-sheet elevation="2" rounded="lg">
                    <v-data-table :headers="headers" :items="tableItems" item-value="smiles" class="elevation-2"
                        ref="retroResultTable" :fixed-header="true">
                        <template v-for="header in headers" v-slot:[`item.${header.key}`]="{ item }" :key="header.key">
                            <div v-if="header.key === 'smiles'" :key="`smiles-${header.key}`">
                                <smiles-image :smiles="item.smiles" width="100px"></smiles-image>
                                <table>
                                    <template v-if="item[1]">
                                        <tbody>
                                            <tr>
                                                    <th>可行性</th>
                                                <td>{{ num2str(item[1].reaction_properties.plausibility) }}</td>
                                            </tr>
                                            <tr>
                                                <th>SCScore</th>
                                                <td>{{ num2str(item[1].precursor_properties.scscore) }}</td>
                                            </tr>
                                        </tbody>
                                    </template>
                                </table>
                            </div>
                            <div v-else :key="`meta-${header.key}`">
	                                <template v-if="item[header.key]">
	                                <table class="text-nowrap">
                                    <tbody :id="'rank-' + item[header.key].rank"> <!-- Add the id tag here -->
                                        <tr> <!-- Add the id tag here -->
                                            <th>前体排序</th>
                                            <td>{{ item[header.key].precursor_rank }}</td>
                                        </tr>
                                        <tr>
                                            <th>前体评分</th>
                                            <td>{{ num2str(item[header.key].precursor_score) }}</td>
                                        </tr>
                                        <tr v-if="predictions[header.key]['model'] === 'template_relevance'">
                                            <th>模板排序</th>
                                            <td>{{ item[header.key].model_metadata[0].source.template.template_rank }}
                                            </td>
                                        </tr>
                                        <tr v-if="predictions[header.key]['model'] === 'template_relevance'">
                                            <th>模板评分</th>
                                            <td>{{
                                                num2str(item[header.key].model_metadata[0].source.template.template_score)
                                                }}
                                            </td>
                                        </tr>
                                        <tr v-if="item[header.key].model_metadata[0].source.template">
                                            <th>模板</th>
                                            <td>
                                                <template
                                                    v-if="predictions[header.key]['model'] === 'template_relevance'">
                                                    <p v-for="id in item[header.key].model_metadata[0].source.template.tforms"
                                                        :key="id" class="mb-0">
                                                        <a :href="`/template?id=${id}`" target="_blank">{{ id }}</a>
                                                    </p>
                                                </template>
                                                <template v-else>
                                                    <v-btn
                                                        v-for="(template, index) in item[header.key].model_metadata[0].source.template.tforms"
                                                        :key="template" size="small" :class="{ 'ml-1': index > 0 }"
                                                        @click="viewTemplate(template)">
                                                        {{ index + 1 }}
                                                    </v-btn>
                                                </template>
                                            </td>
                                        </tr>
	                                    </tbody>
	                                </table>
	                                <reaction-evidence-panel
	                                    v-if="item[header.key].model_metadata?.[0]?.source?.reaction_data || item[header.key].reaction_data"
	                                    :evidence-input="retroReactionEvidenceInput(item[header.key])"
	                                />
	                                </template>
	                                <p v-else><strong>未预测</strong></p>
	                            </div>
                        </template>
                    </v-data-table>
                </v-sheet>
            </v-col>
        </v-row>
    </v-container>

    <v-dialog v-model="allPredictionsDialog" max-width="450px" max-height="700px" scrollable>
        <v-card>
            <v-card-title class="headline">全部预测</v-card-title>
            <v-card-text>
                <v-row>
                    <v-col cols="12" v-for="(item, index) in predictions" :key="index">
                        <div class="justify-center align-center" style="height:100%">
                            <v-card width="400" variant="outlined">
                                <template v-slot:title>
                                    <div class="d-flex justify-space-between align-center">
                                        <div v-if="item.edit" style="width:100%" class="mr-2 mt-2 mb-2">
                                            <v-text-field label="标签" v-model="labels[index]" variant="outlined"
                                                @blur="item.edit = false" @keyup.enter="item.edit = false"
                                                hide-details></v-text-field>
                                        </div>
                                        <div v-else class="d-flex align-items-baseline ml-3">
                                            <h4>{{ labels[index] }}</h4>
                                            <v-icon size="small" icon="mdi mdi-pencil" @click="item.edit = true"
                                                class="ml-2"></v-icon>
                                        </div>
                                        <v-progress-circular v-if="item.loading" color="primary" indeterminate
                                            :width="5"></v-progress-circular>
                                    </div>
                                </template>
                                <v-card-text>
                                    <v-table>
                                        <thead>
                                            <tr>
                                                <th class="text-left">
                                                    模型
                                                </th>
                                                <th class="text-left">
                                                    训练集
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td>{{ item.model }}</td>
                                                <td>{{ item.trainingSet }}</td>
                                            </tr>
                                        </tbody>
                                    </v-table>
                                    <div class="d-flex justify-space-between align-center">
                                        <v-checkbox-btn v-model="item.show" label="在表格中显示"></v-checkbox-btn>
                                        <v-btn v-if="item.model === 'template_relevance'" variant="plain"
                                            @click="viewSettings(item)">查看全部设置</v-btn>
                                        <v-btn variant="tonal" density="compact" color="error"
                                            @click="deleteResult(index)" icon="mdi-delete"
                                            :id="'retro-model-delete-' + (index)"></v-btn>
                                    </div>
                                </v-card-text>
                            </v-card>
                        </div>
                    </v-col>
                </v-row>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" variant="tonal" @click="allPredictionsDialog = false"
                    data-cy="retro-see-all-predictions-ok-btn">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
    <v-dialog v-model="showAdvSettings" width="500px">
        <v-card>
            <v-card-title>
                高级设置
            </v-card-title>
            <v-card-text>
                <setting-input label="模型" label-for="retro-model-1" data-cy="retro-model-1"
                    help-text="选择用于逆合成预测的模型类型。">
                    <v-select hide-details :items="models" item-title="title" item-value="value"
                        v-model="settings.model" variant="outlined" density="compact" class="my-1"></v-select>
                </setting-input>
                <setting-input label="训练集" label-for="retro-training-set-1" data-cy="retro-training-set-1"
                    help-text="选择用于预测的反应训练集。">
                    <v-select hide-details :items="trainingSets" item-title="title" item-value="value"
                        v-model="settings.trainingSet" variant="outlined" density="compact" class="my-1"></v-select>
                </setting-input>
                <setting-input v-if="settings.model === 'template_relevance'" label="前体评分"
                    data-cy="retro-precursor-scoring" label-for="retro-precursor-scoring"
                    help-text="用于重新评分预测前体的方法。">
                    <v-select v-model="settings.precursorScoring" :items="precursorScoringItems" variant="outlined"
                        class="my-1" hide-details density="compact"></v-select>
                </setting-input>
                <setting-input v-if="settings.model === 'template_relevance'" label="最大模板数"
                    data-cy="retro-num-templates" label-for="retro-num-templates"
                    help-text="尝试应用到目标结构的最大反应规则/模板数量；实际数量还会受累计概率阈值影响。">
                    <v-text-field v-model="settings.numTemplates" class="my-1" variant="outlined" density="compact"
                        hide-details></v-text-field>
                </setting-input>
                <setting-input v-if="settings.model === 'template_relevance'" label="最大累计概率"
                    data-cy="retro-max-prob" label-for="retro-max-prob"
                    help-text="当模板分数累计超过该阈值后停止继续应用模板。例如前两个模板分数之和超过阈值时，只返回这两个模板结果。">
                    <v-text-field type="number" min="0" max="1" step="0.000001" v-model.number="settings.maxCumProb"
                        @change="maxCumProb = Math.min(0.99999, maxCumProb)" class="my-1" variant="outlined"
                        density="compact" hide-details></v-text-field>
                </setting-input>
                <setting-input v-if="settings.model === 'template_relevance'" label="最低可行性"
                    data-cy="retro-min-plausibility" label-for="retro-min-plausibility"
                    help-text="Fast Filter 模型给出的最低可行性阈值。该分数可过滤明显不合理建议，但过高时可能过滤掉真实可行结果。">
                    <v-text-field type="number" min="0" max="1" step="0.000001"
                        v-model.number="settings.minPlausibility" class="my-1" variant="outlined" density="compact"
                        hide-details></v-text-field>
                </setting-input>
                <setting-input
                    v-if="settings.model === 'template_relevance' && templateAttributes && templateAttributes[settings.trainingSet] && templateAttributes[settings.trainingSet].length"
                    label="模板属性过滤" data-cy="retro-template-attribute-filters-add-1"
                    help-text="逆合成预测中使用的模板属性过滤条件。只有满足过滤条件的模板会被考虑。">
                    <v-btn icon="mdi-plus" variant="flat" color="primary" @click="addAttributeFilter" density="compact">
                    </v-btn>
                </setting-input>
                <div class="form-inline mb-2 ml-3" v-for="(filter, idx) in settings.attributeFilter" :key="idx">
                    <v-btn icon="mdi-minus" class="mr-2" color="red" variant="tonal" density="compact"
                        :data-cy="'retro-template-attribute-filters-delete-' + (idx)" @click="deleteAttributeFilter(idx)">
                    </v-btn>
                    <v-select class="mr-2" :items="templateAttributes[settings.trainingSet]" :value="filter.name"
                        :data-cy="'retro-template-attribute-filter-type-' + (idx)"
                        @input="updateAttributeFilter(idx, 'name', $event)"> </v-select>
                    <!-- <v-select class="mr-2" :value="filter.logic" @input="updateAttributeFilter(idx, 'logic', $event)">
                        <b-form-select-option value=">">&gt;</b-form-select-option>
                        <b-form-select-option value=">=">&ge;</b-form-select-option>
                        <b-form-select-option value="<">&lt;</b-form-select-option>
                        <b-form-select-option value="<=">&le;</b-form-select-option>
                        <b-form-select-option value="==">=</b-form-select-option>
                    </v-select> -->
                    <v-text-field class="mr-2" type="number" :value="filter.value"
                        :id="'retro-template-attribute-filter-value-' + (idx)"
                        @input="updateAttributeFilter(idx, 'value', $event)"></v-text-field>
                </div>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn variant="flat" color="primary" @click="showAdvSettings = false;"
                    data-cy="retro-advanced-save">保存</v-btn>
                <v-btn variant="flat" color="primary" @click="() => { showAdvSettings = false; runRetro() }"
                    data-cy="retro-advanced-run">运行</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

    <v-dialog v-model="showSettingsViewModal" max-width="600px">
        <v-card>
            <v-card-title class="headline">预测设置</v-card-title>
            <v-card-text>
                <v-table>
                    <tbody>
                        <tr>
                            <th class="text-left">模型</th>
                            <td>{{ selectedSettings.model }}</td>
                        </tr>
                        <tr>
                            <th>训练集</th>
                            <td>{{ selectedSettings.trainingSet }}</td>
                        </tr>
                        <!-- <tr>
                  <th>Model Version</th>
                  <td>{{ selectedSettings.modelVersion }}</td>
                </tr> -->
                        <tr>
                            <th>前体评分</th>
                            <td>{{ selectedSettings.precursorScoring }}</td>
                        </tr>
                        <tr>
                            <th>原子映射器</th>
                            <td>{{ selectedSettings.atomMapper }}</td>
                        </tr>
                        <tr>
                            <th>最大模板数</th>
                            <td>{{ selectedSettings.numTemplates }}</td>
                        </tr>
                        <tr>
                            <th>最大累计概率</th>
                            <td>{{ selectedSettings.maxCumProb }}</td>
                        </tr>
                        <tr>
                            <th>最低可行性</th>
                            <td>{{ selectedSettings.minPlausibility }}</td>
                        </tr>
                        <tr>
                            <th>模板属性过滤</th>
                            <td>
                                <div v-if="selectedSettings.attributeFilter.length">
                                    <p v-for="(filter, index) in selectedSettings.attributeFilter" :key="index">{{
                                        filter.name }} {{ filter.logic }} {{ filter.value }}</p>
                                </div>
                                <span v-else>无</span>
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary darken-1" text @click="showSettingsViewModal = false">关闭</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>

</template>

<script>
import { ref, reactive, computed, watch, onMounted, nextTick } from "vue";
import { useConfirm, useSnackbar } from 'vuetify-use-dialog';
import SmilesImage from "@/components/SmilesImage";
import SettingInput from "@/components/network/SettingInput";
import ReactionEvidencePanel from "@/components/network/ReactionEvidencePanel.vue";
import { API } from "@/common/api";
import { resolveChemName } from "@/common/resolver";
import { num2str } from "@/common/utils";
import {
    getDefaultRetroTrainingSet,
    getRetroModelItems,
    getRetroTrainingSetItems,
} from "@/common/retro-options";
import { useSettingsStore } from "@/store/settings";
import emptyVoid from "@/assets/void.svg";
import DrawButton from "@/components/DrawButton"
import { useConfigStore } from "@/store/config";

const defaultSettings = {
    model: "template_relevance",
    trainingSet: "reaxys",
    precursorScoring: "relevance_heuristic",
    atomMapper: "rxnmapper",
    numTemplates: 1000,
    maxCumProb: 0.999,
    minPlausibility: 0.1,
    attributeFilter: [],
};

export default {
    name: "RetroView",
	    components: {
	        SettingInput,
	        SmilesImage,
	        DrawButton,
	        ReactionEvidencePanel
	    },
    data() {
        return {
            emptyVoid: emptyVoid,
            showAdvSettings: false,
            precursorScoringItems: [
                { title: "Relevance Heuristic", value: "relevance_heuristic" },
                { title: "SCScore", value: "scscore" }
            ],
            atomMapperItems: [
                { title: "RXNMapper", value: "rxnmapper" },
                { title: "Indigo", value: "indigo" }
            ],
        }
    },
    setup() {
        const createConfirm = useConfirm()
        const createSnackbar = useSnackbar()
        const target = ref("");
        const validSmiles = ref(true);
        const modelStatus = ref([]);
        const templateSets = ref([]);
        const templateAttributes = ref({});
        const settings = reactive(JSON.parse(JSON.stringify(defaultSettings)));
        const predictions = ref({});
        const results = ref({});
        const labels = ref({});
        const selectedSettings = ref(null);
        const showSettingsViewModal = ref(false);
        const selectedTemplate = ref(null);
        const showTemplateInfoModal = ref(false);
        const carouselSlide = ref(0);
        const retroResultTable = ref(null);
        const ketcherRef = ref(null)
        const showKetcher = ref(false)
        const allPredictionsDialog = ref(false)
        const configStore = useConfigStore();

	        function hide(key) {
	            predictions.value[key].show = false;
	        }

	        function retroReactionEvidenceInput(prediction) {
	            const metadata = prediction?.model_metadata?.[0];
	            return {
	                reactionData: metadata?.source?.reaction_data || prediction?.reaction_data || {},
	                reactionId: prediction?.reaction_id || metadata?.source?.reaction_id || "",
	                reactionSet: prediction?.reaction_set || metadata?.model_name || "",
	            };
	        }

	        const context = computed(() => JSON.parse(document.getElementById("django-context").textContent));

        const enableResolver = computed({ get: () => configStore.envs.VITE_ENABLE_SMILES_RESOLVER === 'True' });

        const maxIndex = computed(() => {
            const indices = Object.keys(predictions.value).map((val) => Number(val));
            return indices.length > 0 ? Math.max(...indices) : 0;
        });

        const models = computed(() => {
            return getRetroModelItems(modelStatus.value);
        });
        const trainingSets = computed(() => {
            return getRetroTrainingSetItems(settings.model, modelStatus.value);
        });

        const precursors = computed(() => {
            // Compile full list of precursors by combining results from each prediction
            const precursors = {};
            Object.entries(results.value).forEach(([index, resultsN]) => {
                resultsN.forEach((res) => {
                    if (res.outcome in precursors) {
                        precursors[res.outcome][index] = res;
                    } else {
                        precursors[res.outcome] = {};
                        precursors[res.outcome][index] = res;
                        precursors[res.outcome]["plausibility"] = res["plausibility"];
                        precursors[res.outcome]["num_rings"] = res["num_rings"];
                        precursors[res.outcome]["rms_molwt"] = res["rms_molwt"];
                        precursors[res.outcome]["scscore"] = res["scscore"];
                    }
                });
            });
            return precursors;
        });

        const shownPredictions = computed(() => {
            return Object.keys(predictions.value).filter((index) => predictions.value[index].show);
        });

        const headers = computed(() => {
            const fields = [{ key: "smiles", title: "Precursor", width: '200px' }];
            Object.entries(predictions.value).forEach(([index, item]) => {
                if (item.show && !item.loading) {
                    fields.push({ key: index, title: labels.value[index], sortable: false, removable: true })
                }
            })
            console.log(fields)
            return fields;
        })

        const tableFields = computed(() => {
            const classes = ["text-center", "align-middle"];
            const fields = [{ key: "smiles", label: "Precursor", stickyColumn: true, tdClass: classes, thClass: classes }];
            Object.entries(predictions.value).forEach(([index, item]) => {
                if (item.show && !item.loading) {
                    fields.push({ key: index, label: labels.value[index], sortable: false, tdClass: classes, thClass: classes });
                }
            });
            return fields;
        });

        const tableItems = computed(() => {
            let items = Object.entries(precursors.value).map(([smiles, item]) => ({
                smiles: smiles,
                ...item,
            }));
            return items
        });

        const allowResolve = computed({
            get() {
                const settingsStore = useSettingsStore();
                return settingsStore.allowResolve;
            },
            set(value) {
                const settingsStore = useSettingsStore();
                settingsStore["allowResolve"] = value;
            },
        });

        onMounted(() => {
            API.get("/api/template/sets/", null, false).then((json) => {
                templateAttributes.value = json.attributes;
                templateSets.value = json.template_sets

            });
            API.get("/api/admin/get-backend-status", null, false).then((json) => {
                modelStatus.value = json["modules"];
            });
        });

        const toggleResolver = () => {
            allowResolve.value = !allowResolve.value;
        };

        const canonicalize = async (smiles) => {
            const json = await API.post("/api/rdkit/canonicalize/", { smiles: smiles });
            return json.smiles;
        };

        const resolve = async () => {
            if (enableResolver.value && allowResolve.value && target.value && validSmiles.value) {
                await resolveChemName(target.value)
                    .then((smiles) => canonicalize(smiles))
                    .then((smiles) => {
                        target.value = smiles;
                        validSmiles.value = true;
                    })
                    .catch((error) => {
                        console.error(error);
                    });
            }
        };

        const checkTrainingSets = (newTrainingSet) => {
            // Returns true if the new training set is NOT compatible with the existing predictions
            let trainingSets = new Set(Object.values(predictions.value).map((pred) => pred.trainingSet));
            trainingSets.add(newTrainingSet);
            return trainingSets.has("cas") && trainingSets.size > 1;
        };

        const runRetro = async () => {
            // if (!context.value["casKeyOk"] && checkTrainingSets(settings.trainingSet)) {
            //     alert("The CAS training set cannot be used for predictions alongside other models.");
            //     return;
            // }
            const newIndex = maxIndex.value + 1;
            carouselSlide.value = Object.keys(predictions.value).length;
            await resolve();

            const url = "/api/tree-search/expand-one/call-async";
            const body = {
                smiles: target.value,
                retro_backend_options: [
                    {
                        retro_backend: settings.model,
                        max_num_templates: settings.numTemplates,
                        max_cum_prob: settings.maxCumProb,
                        retro_model_name: settings.trainingSet,
                    },
                ],
                retro_rerank_backend: settings.precursorScoring,
                atom_map_backend: settings.atomMapper,
                use_fast_filter: true,
                fast_filter_threshold: settings.minPlausibility,
                cluster_precursors: false,
                selectivity_check: settings.false,
            };
            // Make a deep copy of the settings object
            const settingsCopy = JSON.parse(JSON.stringify(settings));
            settingsCopy.loading = true;
            settingsCopy.show = true;
            settingsCopy.edit = false;
            predictions.value[newIndex] = settingsCopy;
            labels.value[newIndex] = `预测 #${newIndex}`;
            API.runCeleryTask(url, body)
                .then((output) => {
                    if (output["status_code"] === 500) {
                        // alert("There was an error predicting precursors for this target: " + output["message"]);
                        createConfirm({ title: '预测失败', content: "预测该目标前体时出错：" + output["message"], dialogProps: { width: "60%" } })
                        return;
                    }
                    results.value[newIndex] = output["result"];
                    /* eslint-disable */
                    nextTick(() => {
                        if (retroResultTable.value) {
                            retroResultTable.value.refresh();
                        }
                    });
                })
                .catch((error) => {
                    // alert("There was an error predicting precursors for this target: " + error);
                    createConfirm({ title: '预测失败', content: "预测该目标前体时出错：" + error["message"], dialogProps: { width: "60%" } })
                })
                .finally(() => {
                    predictions.value[newIndex].loading = false;
                });
        };

        const clear = (skipConfirm = false) => {
            let runningPreds = false;
            runningPreds = Object.values(predictions.value).some((prediction) => {
                if (prediction.loading) {
                    return true;
                }
            })
            if (runningPreds) {
                createSnackbar({ text: "仍有预测任务在运行，请完成后再清空。", snackbarProps: { timeout: -1, vertical: true } })
                return;
            }
            if (skipConfirm || confirm("这会清空当前所有结果，是否继续？")) {
                target.value = "";
                predictions.value = {};
                results.value = {};
                labels.value = {};
                selectedSettings.value = null;
                selectedTemplate.value = null;
            }
        };

        const deleteResult = (index) => {
            if (predictions.value[index].loading) {
                alert("请等待 " + labels.value[index] + " 完成。")
                return;
            }
            if (confirm("删除该预测后无法撤销，是否继续？")) {
                delete predictions.value[index];
                delete results.value[index];
                delete labels.value[index];
                carouselSlide.value = 0;
            }
        };

        const viewSettings = (settings) => {
            selectedSettings.value = settings;
            showSettingsViewModal.value = true;
        };

        const viewTemplate = (template) => {
            selectedTemplate.value = template;
            showTemplateInfoModal.value = true;
        };

        const tableItemProvider = ({ sortBy, sortDesc }) => {
            const mult = sortDesc ? -1 : 1;
            return Object.entries(precursors.value)
                .map(([smiles, item]) => ({
                    smiles: smiles,
                    ...item,
                }))
                .sort((a, b) => mult * sortCompare(a, b, sortBy));
        };

        const sortCompare = (aObj, bObj, field) => {
            const a = aObj[field];
            const b = bObj[field];
            if (a === b) {
                return 0;
            } else if (a === undefined) {
                return 1;
            } else if (b === undefined) {
                return -1;
            } else {
                if (field === "smiles") {
                    return (a > b) - (a < b);
                } else {
                    return (a["rank"] > b["rank"]) - (a["rank"] < b["rank"]);
                }
            }
        };

        const addAttributeFilter = () => {
            settings.attributeFilter.push({
                name: templateAttributes.value[settings.trainingSet][0],
                logic: ">",
                value: 0.5,
            });
        };

        const deleteAttributeFilter = (index) => {
            settings.attributeFilter.splice(index, 1);
        };

        const updateAttributeFilter = (index, key, value) => {
            settings.attributeFilter[index][key] = value;
        };

        watch(
            () => settings.model,
            function () {
                settings.trainingSet = getDefaultRetroTrainingSet(settings.model, modelStatus.value) || trainingSets.value[0]?.value;
                settings.attributeFilter = [];
            }
        );

        watch(
            () => settings.trainingSet,
            function () {
                settings.attributeFilter = [];
            }
        );

        return {
            headers,
            hide,
            carouselSlide,
            target,
            validSmiles,
            modelStatus,
            templateSets,
            templateAttributes,
            settings,
            predictions,
            results,
            resolve,
            labels,
            selectedSettings,
            showSettingsViewModal,
            selectedTemplate,
            showTemplateInfoModal,
            context,
            enableResolver,
            maxIndex,
            models,
            trainingSets,
            precursors,
            shownPredictions,
            tableFields,
            tableItems,
            allowResolve,
            toggleResolver,
            canonicalize,
            checkTrainingSets,
            runRetro,
            clear,
            deleteResult,
            viewSettings,
            viewTemplate,
	            tableItemProvider,
	            sortCompare,
	            retroReactionEvidenceInput,
	            addAttributeFilter,
            deleteAttributeFilter,
            updateAttributeFilter,
            num2str,
            showKetcher,
            ketcherRef,
            allPredictionsDialog,
        };
    },
};
</script>
