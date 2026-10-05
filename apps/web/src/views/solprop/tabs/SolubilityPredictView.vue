<template>
  <v-container fluid style="min-height: calc(100vh-50px)">
    <v-row class="justify-center">
      <v-col cols="12" md="12" class="pa-0">
        <v-sheet elevation="2" class="pa-10" rounded="lg" width="100%">
          <v-form @submit.prevent="predict" ref="form">
            <v-row>
              <v-col cols="12" md="4">
                <StructureInput ref="soluteInput" v-model="solute" label="溶质"
                  :disabled="loading" data-cy="solpred-solute" />
              </v-col>
              <v-col cols="12" md="4">
                <StructureInput ref="solventInput" v-model="solvent" label="溶剂"
                  :disabled="loading" data-cy="solpred-solvent" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field :rules="[v => !!v || '必须输入温度']" variant="outlined" label="温度"
                  v-model="temperature" data-cy="solpred-temp" clearable prepend-inner-icon="mdi-thermometer-lines"
                  rounded="pill">
                </v-text-field>
              </v-col>

            </v-row>
            <v-row justify-start class="align-center justify-center">
              <v-col class="solpred-actions">
                <v-btn data-cy="solpred-submit" type="submit" variant="flat" color="primary" class="mr-5"
                  :loading="!batch && loading" :disabled="loading || structurePending || !selectedModel">提交</v-btn>
                <v-btn type="button" data-cy="solpred-run-batch" variant="flat" color="yellow-darken-4" class="mr-5"
                  @click="showUploadModal = true" :loading="batch && loading" :disabled="!selectedModel">批量运行</v-btn>
                <v-menu location="bottom" id="tb-submit-settings" :close-on-content-click="false">
                  <template v-slot:activator="{ props }">
                    <v-tooltip location="bottom"
                      :text="selectedModel ? `当前模型：${selectedModel === 'solprop' ? 'Fusion Cycle' : selectedModel === 'fastsolv' ? 'FastSolv' : selectedModel === 'legacy' ? 'SolProp' : selectedModel}` : '请选择模型'"
                      :model-value="!selectedModel || undefined">
                      <template v-slot:activator="{ props: tprops }">
                        <v-btn color="primary" append-icon="mdi mdi-menu-down" variant="flat" data-cy="model-selection"
                          v-bind="Object.assign({}, props, tprops)" class="mr-5">
                          模型
                        </v-btn>
                      </template>
                    </v-tooltip>
                  </template>
                  <v-list min-width="200px">
                    <v-list-item @click="selectedModel = 'solprop'">
                      <v-list-item-title>
                        <v-icon v-if="selectedModel === 'solprop'" icon="mdi-check"></v-icon>
                        Fusion Cycle
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="selectedModel = 'fastsolv'">
                      <v-list-item-title>
                        <v-icon v-if="selectedModel === 'fastsolv'" icon="mdi-check"></v-icon>
                        FastSolv
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="selectedModel = 'legacy'">
                      <v-list-item-title>
                        <v-icon v-if="selectedModel === 'legacy'" icon="mdi-check"></v-icon>
                        SolProp
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <v-btn @click="dialog = true" variant="flat" class="mr-5" prepend-icon="mdi-dots-horizontal"
                  color="info">
                  更多参数
                </v-btn>
                <v-btn data-cy="solpred-clear-results" variant="tonal" class="mr-5" :disabled="results.length === 0"
                  @click="clear()">
                  清空结果
                </v-btn>
                <v-btn class="mr-5 align-self-end" variant="tonal" @click="showInfo = !showInfo" color="info">模型输入/输出说明</v-btn>
              </v-col>
            </v-row>
          </v-form>
        </v-sheet>
      </v-col>
    </v-row>
    <!-- 
    <v-row v-if="!selectedModel && (solute || solvent || temperature)" class="mt-2">
      <v-col cols="12" class="pa-0">
        <v-alert type="info" variant="tonal" closable>
          <v-alert-title>Model Selection Required</v-alert-title>
          Please select a model (SolProp - Fusion Cycle or FastSolv) to proceed with the prediction.
        </v-alert>
      </v-col>
    </v-row> -->

    <v-row>
      <v-col v-show="pendingTasks > 0 || results.length" cols="12" md="12" class="pa-0 mt-4">
        <v-sheet elevation="2" class="pa-4" rounded="lg">
          <v-row align="center" justify="space-between" class="mx-auto my-3">
            <v-alert border="start" type="info" variant="tonal" density="compact" :title="contextTitle">
              <p v-for="(block, i) in contextBlocks" :key="i" :class="{ 'mt-1': i > 0 }">
                <template v-for="(text, j) in block.texts" :key="j">
                  {{ text }}<br v-if="j < block.texts.length - 1" />
                </template>
                <a v-if="block.ref" class="text-decoration-none text-primary font-weight-medium d-inline-flex align-center"
                  :href="block.ref.url" target="_blank">
                  &nbsp;({{ block.ref.text }} <v-icon size="x-small">mdi-open-in-new</v-icon>)
                </a>
              </p>
            </v-alert>
          </v-row>
          <v-row v-if="pendingTasks === 0" class="mx-auto my-auto pa-2">
            <v-col md="5">
              <v-menu location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn v-show="!!results.length" color="primary" v-bind="props" prepend-icon="mdi mdi-download"
                    variant="flat" data-cy="solpred-download">
                    下载
                  </v-btn>
                </template>
                <v-list>
                  <v-list-item data-cy="solpred-download-csv" @click="downloadCSV()">下载 CSV</v-list-item>
                  <v-list-item data-cy="solpred-download-json" @click="downloadJSON()">下载 JSON</v-list-item>
                </v-list>
              </v-menu>
            </v-col>
            <v-spacer md="2"></v-spacer>
            <v-col md="5">
              <v-select :model-value="selectedColumnCategories" :items="allfields" label="选择字段"
                density="comfortable" variant="outlined" hide-details clearable @update:modelValue="onSelectedCategory"
                multiple data-cy="solpred-select-columns">
                <template v-slot:prepend-item>
                  <v-list-item ripple @click="toggleAllCategories" data-cy="solpred-select-all">
                    <v-list-item-title>全选</v-list-item-title>
                  </v-list-item>
                  <v-divider></v-divider>
                </template>
                <template v-slot:selection="{ item }">
                  <!-- <pre>{{  index }}</pre> -->
                  <v-chip>
                    <span>{{ item.title }}</span>
                    <v-icon small @click.prevent="deselectColumn(item)">
                      mdi-close-circle
                    </v-icon>
                  </v-chip>
                </template>
              </v-select>
            </v-col>
            <v-row class="mt-3" style="overflow-x:scroll">
              <v-col cols="12">
                <v-data-table :page="lastPage" :items-per-page="itemsPerPage"
                  @update:itemsPerPage="$event => itemsPerPage = $event" :headers="fields" :items="results"
                  data-cy="solpred-table" :row-props="colorRowItem">
                  <template v-slot:item.st_1="{ item }">
                    {{ item.st_1 != null && !isNaN(Number(item.st_1)) ? Number(item.st_1).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.st_2="{ item }">
                    {{ item.st_2 != null && !isNaN(Number(item.st_2)) ? Number(item.st_2).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.s_298="{ item }">
                    {{ item.s_298 != null && !isNaN(Number(item.s_298)) ? Number(item.s_298).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.log_st_1="{ item }">
                    {{ item.log_st_1 != null && !isNaN(Number(item.log_st_1)) ? Number(item.log_st_1).toExponential(2) :
                    '' }}
                  </template>
                  <template v-slot:item.log_st_2="{ item }">
                    {{ item.log_st_2 != null && !isNaN(Number(item.log_st_2)) ? Number(item.log_st_2).toExponential(2) :
                    '' }}
                  </template>
                  <template v-slot:item.log_s_298="{ item }">
                    {{ item.log_s_298 != null && !isNaN(Number(item.log_s_298)) ?
                    Number(item.log_s_298).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.uncertainty="{ item }">
                    {{ item.uncertainty != null && !isNaN(Number(item.uncertainty)) ?
                    Number(item.uncertainty).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.uncertainty_log_s_298="{ item }">
                    {{ item.uncertainty_log_s_298 != null && !isNaN(Number(item.uncertainty_log_s_298)) ?
                    Number(item.uncertainty_log_s_298).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.MP_pred="{ item }">
                    {{ item.MP_pred != null && !isNaN(Number(item.MP_pred)) ? Number(item.MP_pred).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.MP_std="{ item }">
                    {{ item.MP_std != null && !isNaN(Number(item.MP_std)) ? Number(item.MP_std).toExponential(2) : '' }}
                  </template>
                  <template v-slot:item.gamma="{ item }">
                    {{ item.gamma != null && !isNaN(Number(item.gamma)) ? Number(item.gamma).toExponential(2) : '' }}
                  </template>
                </v-data-table></v-col>
            </v-row>
          </v-row>
          <v-row v-else justify="space-between" class="mx-auto my-auto pa-2">
            <v-skeleton-loader class="mx-auto my-auto" min-height="80px" type="table" width="100%"></v-skeleton-loader>
          </v-row>
        </v-sheet>
      </v-col>
      <v-col v-show="!results.length && pendingTasks === 0" cols="12" class="pa-0 mt-4">
        <v-sheet elevation="2" rounded="lg" class="pa-4">
          <v-row align="center" justify="space-between" class="mx-auto my-3">
            <v-alert border="start" type="info" variant="tonal" density="compact" :title="contextTitle">
              <p v-for="(block, i) in contextBlocks" :key="i" :class="{ 'mt-1': i > 0 }">
                <template v-for="(text, j) in block.texts" :key="j">
                  {{ text }}<br v-if="j < block.texts.length - 1" />
                </template>
                <a v-if="block.ref" class="text-decoration-none text-primary font-weight-medium d-inline-flex align-center"
                  :href="block.ref.url" target="_blank">
                  &nbsp;({{ block.ref.text }} <v-icon size="x-small">mdi-open-in-new</v-icon>)
                </a>
              </p>
            </v-alert>
          </v-row>
          <div class="d-flex flex-column align-center justify-center text-center">
            <img src="@/assets/emptySolProp.svg" :width="400" class="mb-3" cover />
            <h2>暂无结果</h2>
            <p class="text-body-1">请在上方输入溶质、溶剂和温度后生成预测。</p>
          </div>
        </v-sheet>
      </v-col>
    </v-row>

    <v-dialog v-model="showUploadModal" max-width="600px">
      <v-card>
        <v-card-title class="mt-2">
          <v-col cols="12">上传文件</v-col>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" class="mb-2">
              <span>
                文件格式请参考“模型输入/输出说明”。
              </span>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <v-file-input data-cy="solpred-file-upload" label="文件" v-model="uploadFile"
                :rules="[v => !!v || '必须上传文件']" density="comfortable" variant="outlined"
                clearable></v-file-input>
            </v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn data-cy="solpred-file-upload-close" color="blue darken-1" text
            @click="showUploadModal = false">关闭</v-btn>
          <v-btn data-cy="solpred-file-upload-upload" color="primary" text
            @click="handleUploadSubmit">上传</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="dialog" max-width="600px" class="justify-center align-center">
      <v-card>
        <v-card-title class="headline">
          附加参数
        </v-card-title>
        <v-divider></v-divider>
        <v-card-text class="pa-3">
          <v-expand-transition>
            <v-expansion-panels v-model="panel" multiple>
              <v-expansion-panel title="密度（可选，仅适用于 Fusion Cycle 模型）" class="text-primary">
                <v-expansion-panel-text class="text-black">
                  <v-text-field variant="outlined" label="密度" v-model="density"
                    :disabled="selectedModel !== 'solprop'"></v-text-field>
                </v-expansion-panel-text>
              </v-expansion-panel>
              <v-expansion-panel title="参考信息（可选）" class="text-primary">
                <v-expansion-panel-text class="text-black">
                  <StructureInput ref="referenceInput" v-model="refSolvent" label="参考溶剂"
                    :disabled="loading" />
                  <v-text-field variant="outlined" label="参考溶解度 (log10(mol/L))"
                    v-model="refSolubility"></v-text-field>
                  <v-text-field variant="outlined" label="参考温度 (K)" v-model="refTemperature"></v-text-field>
                </v-expansion-panel-text>
              </v-expansion-panel>
              <v-expansion-panel title="溶质信息（可选）" class="text-primary">
                <v-expansion-panel-text class="text-black">
                  <v-text-field variant="outlined" label="ΔHsub298 (kcal/mol)" v-model="soluteHsub"></v-text-field>
                  <v-text-field variant="outlined" label="Cpg298 (cal/mol/K)" v-model="soluteCpg"></v-text-field>
                  <v-text-field variant="outlined" label="Cps298 (cal/mol/K)" v-model="soluteCps"></v-text-field>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-expand-transition>
        </v-card-text>
        <v-divider></v-divider>
        <v-card-actions class="d-flex justify-end pa-3">
          <v-btn class="mr-2" variant="tonal" color="primary" @click="dialog = false">
            保存
          </v-btn>
          <v-btn variant="tonal" color="primary" :disabled="loading || structurePending || !selectedModel"
            @click="() => { dialog = false; predict() }">
            运行
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
  <solubility-modal :visible="showInfo" width="auto" @close-dialog="$event => showInfo = $event"></solubility-modal>
</template>

<script>
import { ref } from "vue";
import StructureInput from "@/components/workspace/StructureInput.vue";
import SolubilityModal from '@/components/solprop/SolubilityModal'
import ErrorDialog from '@/components/ErrorDialog'
import { API } from "@/common/api";
import { saveAs } from "file-saver";
import * as Papa from "papaparse";
import { useConfirm } from 'vuetify-use-dialog'

let _contextOverviewCache = null

export default {
  name: "SolubilityPrediction",
  components: {
    SolubilityModal,
    StructureInput
  },
  setup() {
    const createConfirm = useConfirm();
    return {
      createConfirm,
      soluteInput: ref(null),
      solventInput: ref(null),
      referenceInput: ref(null),
    }
  },
  data() {
    return {
      itemsPerPage: 10,
      panel: [0],
      pendingTasks: 0,
      solvent: '',
      solute: '',
      temperature: 298,
      refSolvent: '',
      refSolubility: null,
      refTemperature: null,
      soluteHsub: null,
      soluteCpg: null,
      soluteCps: null,
      density: null,
      dialog: false,
      showUploadModal: false,
      results: [],
      tab: "one",
      uploadFile: null,
      selectedColumnCategories: [
        '模型',
        '密度',
        '温度溶解度 [mg/mL]',
        'logST',
        '熔点与活度系数',
        '298K 溶解度 [mg/mL]',
        'logS 不确定度 [log10(mol/L)]'
      ],
      columnCategories: {
        '模型': ['model'],
        '输入参考数据': ['ref_solvent', 'ref_solubility', 'ref_temp'],
        '输入溶质数据': ['hsub298', 'cp_gas_298', 'cp_solid_298'],
        'logST': ['log_st_1', 'log_st_2'],
        '温度溶解度 [mg/mL]': ['st_1', 'st_2'],
        '密度': ['density'],
        'dGsolvT': ['dg_solv_t'],
        'dHsolvT': ['dh_solv_t'],
        'dSsolvT': ['ds_solv_t'],
        'logS298': ['log_s_298'],
        '298K 溶解度 [mg/mL]': ['s_298'],
        'dGsolv298': ['dg_solv_298', 'uncertainty_dg_solv_298'],
        'dHsolv298': ['dh_solv_298', 'uncertainty_dh_solv_298'],
        '预测溶质数据': ['pred_hsub298', 'pred_cpg298', 'pred_cps298'],
        '溶质 Abraham 参数': ['E', 'S', 'A', 'B', 'L', 'V'],
        '消息': ['error_message', 'warning_message'],
        'logS 不确定度 [log10(mol/L)]': ['uncertainty', 'uncertainty_log_s_298'],
        '熔点与活度系数': ['MP_pred', 'MP_std', 'gamma']
      },
      fields: [

      ],
      apiKeyToField: {
        'Solute': '溶质',
        'Solvent': '溶剂',
        'Temp': '温度',
        'model': '模型',
        'ref_solvent': '参考溶剂',
        'ref_solubility': '参考溶解度',
        'ref_temp': '参考温度',
        'hsub298': 'Input Hsub298',
        'cp_gas_298': 'Input Cpg298',
        'cp_solid_298': 'Input Cps298',
        'log_st_1': 'logST (method1) [log10(mol/L)]',
        'st_1': 'Solubility (method1) [mg/mL]',
        'log_st_2': 'logST (method2) [log10(mol/L)]',
        'st_2': 'Solubility (method2) [mg/mL]',
        'dg_solv_t': 'dGsolvT',
        'dh_solv_t': 'dHsolvT',
        'ds_solv_t': 'dSsolvT',
        'log_s_298': 'logS298 [log10(mol/L)]',
        'uncertainty_log_s_298': 'Uncertainty logS298 [log10(mol/L)]',
        's_298': 'Solubility(298) [mg/mL]',
        'dh_solv_298': 'dHsolv298',
        'dg_solv_298': 'dGsolv298 [kcal/mol]',
        'uncertainty_dg_solv_298': 'Uncertainty dGsolv298 [kcal/mol]',
        'uncertainty_dh_solv_298': "Uncertainty dHsolv298",
        'error_message': '错误信息',
        'warning_message': '警告信息',
        'pred_hsub298': 'Pred. Hsub298 [kcal/mol]',
        'pred_cpg298': 'Pred. Cpg298 [cal/K/mol]',
        'pred_cps298': 'Pred. Cps298 [cal/K/mol]',
        'E': 'E',
        'S': 'S',
        'A': 'A',
        'B': 'B',
        'L': 'L',
        'V': 'V',
        'uncertainty': 'Uncertainty logS [log10(mol/L)]',
        'density': '密度',
        'MP_pred': '熔点 (K)',
        'MP_std': '熔点标准差 (K)',
        'gamma': '活度系数'
      },
      loading: false,
      showInfo: false,
      batch: false,
      selectedModel: 'solprop',
      models: [
        { title: 'Fusion Cycle', value: 'solprop' },
        { title: 'FastSolv', value: 'fastsolv' },
        { title: 'SolProp', value: 'legacy' },
      ],
      contextOverview: '',
    }
  },
  computed: {
    colorRowItem() {
      return (item) => {
        return {
          class: {
            'highlight-row': item.item.new === this.results.length
          }
        };
      };
    },
    allfields() {
      return Object.keys(this.columnCategories).map((key) => ({ key: key, title: key }))
    },
    lastPage() {
      return Math.ceil(this.results.length / this.itemsPerPage);
    },
    exportFileName() {
      let baseName = 'askcos'
      if (this.uploadFile) {
        const inputName = this.uploadFile.name
        baseName = inputName.substring(0, inputName.lastIndexOf('.'))
      }
      return baseName + '_solubility_export'
    },
    structurePending() {
      return Boolean(this.soluteInput?.pending || this.solventInput?.pending || this.referenceInput?.pending)
    },
    contextTitle() {
      const lines = this.contextOverview.split('\n')
      return lines[0] ? '溶解度模型说明' : ''
    },
    contextBlocks() {
      const lines = this.contextOverview.split('\n').filter(l => l.trim())
      if (lines.length) {
        return [{
          texts: [
            '根据溶质、溶剂和温度输入，模型会输出溶解度、热力学描述符和不确定度参考。',
            '预测值用于溶剂筛选和实验设计前评估，正式工艺仍需实测确认。'
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
    }
  },
  created() {
    // Prompt user before going back to previous page
    window.addEventListener('beforeunload', (e) => {
      if (this.results.length && !this.loading) {
        // Cancel the event
        e.preventDefault(); // If you prevent default behavior in Mozilla Firefox prompt will always be shown
        // Chrome requires returnValue to be set
        e.returnValue = '';
      }
    });

    let urlParams = new URLSearchParams(window.location.search);
    let solute = urlParams.get('solute')
    if (solute) {
      this.solute = solute
    }
    let solvent = urlParams.get('solvent')
    if (solvent) {
      this.solvent = solvent
    }

    this.fetchContextOverview()
    this.onSelectedCategory();
  },
  methods: {
    fetchContextOverview() {
      if (_contextOverviewCache) {
        this.contextOverview = _contextOverviewCache
        return
      }
      API.get('/api/tooltip/solubility/solubility-overview')
        .then(data => {
          _contextOverviewCache = data
          this.contextOverview = data
        })
    },
    deselectColumn(item) {
      const index = this.selectedColumnCategories.indexOf(item.title);
      if (index !== -1) {
        this.selectedColumnCategories.splice(index, 1);
      }
      this.$nextTick(() => {
        this.onSelectedCategory();
      });
    },
    toggleAllCategories() {
      if (this.selectedColumnCategories.length < this.allfields.length) {
        this.selectedColumnCategories = this.allfields.map(category => category.key);
      } else {
        this.selectedColumnCategories = [];
      }
      this.onSelectedCategory();
    },
    remove(key) {
      this.fields = this.fields.filter(header => header.key !== key)
    },
    clear() {
      this.results = []
    },
    onSelectedCategory(value) {
      if (value) {
        this.selectedColumnCategories = value
      }
      const baseFields = [
        { key: 'Solute', title: this.apiKeyToField['Solute'], sortable: true, removable: false },
        { key: 'Solvent', title: this.apiKeyToField['Solvent'], sortable: true, removable: false },
        { key: 'Temp', title: this.apiKeyToField['Temp'], sortable: true, removable: false },
      ];
      this.selectedColumnCategories.forEach((category) => {
        this.columnCategories[category].forEach((key) => {
          baseFields.push({ key: key, title: this.apiKeyToField[key], sortable: true, removable: true });
        });
      });

      this.fields = baseFields;
    },
    buildRequestBody(model) {
      if (!model) {
        console.error('No model selected')
        return null
      }
      if (model === 'legacy') {
        return {
          task_list: [{
            solvent: this.solvent,
            solute: this.solute,
            temp: this.temperature,
            ref_solvent: this.refSolvent || null,
            ref_solubility: this.refSolubility || null,
            ref_temp: this.refTemperature || null,
            hsub298: this.soluteHsub || null,
            cp_gas_298: this.soluteCpg || null,
            cp_solid_298: this.soluteCps || null,
          }]
        }
      }
      const body = {
        solvent_smiles: [this.solvent],
        solute_smiles: [this.solute],
        temperature: [this.temperature],
      }
      if (this.density != null && this.density !== '' && model === 'solprop') {
        body.density = [Number(this.density)]
      }
      return body
    },
    predict() {
      if (this.loading || this.structurePending || !this.selectedModel || !this.solute.trim() || !this.solvent.trim()) return
      this.pendingTasks += 1
      this.loading = true
      this.batch = false
      const url = this.selectedModel === 'solprop'
        ? '/api/solubility/fusion-cycle/call-async'
        : this.selectedModel === 'fastsolv'
          ? '/api/fastsolv/call-async'
          : '/api/solubility/batch/call-async';
      API.runCeleryTask(url, this.buildRequestBody(this.selectedModel))
        .then(output => {
          const inputDensity = this.density != null && this.density !== '' ? Number(this.density) : null
          if (this.selectedModel === 'solprop' ){
            this.results.unshift(...output.map(item => {
               const result = { ...item, model: 'Fusion Cycle' }
              if (inputDensity != null) {
                result.density = inputDensity
              }
              return result
            }))
          } else if (this.selectedModel === 'fastsolv') {
            this.results.unshift(...output.map(item => ({ ...item, model: 'FastSolv' })))
          } else {
            this.results.unshift(...output.map(item => ({ ...item, model: 'SolProp' })))
          }
          this.results[0].new = this.results.length
        })
        .catch(async error => {
          const errorObj = API.toErrorObject(error, '溶解度预测失败，请检查输入、模型服务和后端任务状态。')
          const isConfirmed = await this.createConfirm({ title: "请求失败", contentComponent: ErrorDialog, contentComponentProps: { errorObj: errorObj }, dialogProps: { width: "auto" } })
          if (!isConfirmed)
            return
        })
        .finally(() => {
          this.loading = false;
          this.pendingTasks -= 1;
        })
    },
    predictBatch(data) {
      this.pendingTasks += 1
      this.loading = true
      this.batch = true
      const url = this.selectedModel === 'solprop'
        ? '/api/solubility/fusion-cycle/call-async'
        : this.selectedModel === 'fastsolv'
          ? '/api/fastsolv/call-async'
          : '/api/solubility/batch/call-async';
      let body
      if (this.selectedModel === 'legacy') {
        body = {
          task_list: data.map(item => ({
            solvent: item.solvent || item.solvent_smiles || '',
            solute: item.solute || item.solute_smiles || '',
            temp: item.temp || item.temperature || 298,
            ref_solvent: item.ref_solvent || null,
            ref_solubility: item.ref_solubility || null,
            ref_temp: item.ref_temp || null,
            hsub298: item.hsub298 || null,
            cp_gas_298: item.cp_gas_298 || null,
            cp_solid_298: item.cp_solid_298 || null,
          }))
        }
      } else {
        body = {
          solvent_smiles: data.map(item => item.solvent || item.solvent_smiles || ''),
          solute_smiles: data.map(item => item.solute || item.solute_smiles || ''),
          temperature: data.map(item => item.temp || item.temperature || 298),
        }
        const densities = data.map(item => item.density != null ? Number(item.density) : null)
        if (densities.some(v => v != null) && this.selectedModel === 'solprop') {
          body.density = densities
        }
      }
      API.runCeleryTask(url, body)
        .then(output => {
          if (this.selectedModel === 'solprop' ){
            this.results.unshift(...output.map((item, idx) => {
               const result = { ...item, model: 'Fusion Cycle', new: this.results.length + output.length }
              const inputDensity = body.density ? body.density[idx] : null
              if (inputDensity != null) {
                result.density = inputDensity
              }
              return result
            }));
          } else if (this.selectedModel === 'fastsolv') {
            this.results.unshift(...output.map(item => ({ ...item, model: 'FastSolv', new: this.results.length + output.length })));
          } else {
            this.results.unshift(...output.map(item => ({ ...item, model: 'SolProp', new: this.results.length + output.length })));
          }
        })
        .catch(async error => {
          const errorObj = API.toErrorObject(error, '批量溶解度预测失败，请检查输入文件、模型服务和后端任务状态。')
          const isConfirmed = await this.createConfirm({ title: "请求失败", contentComponent: ErrorDialog, contentComponentProps: { errorObj: errorObj }, dialogProps: { width: "auto" } })
          if (!isConfirmed)
            return
        })
        .finally(() => {
          this.loading = false
          this.pendingTasks -= 1
        })
    },
    handleUploadSubmit() {
      let fileFormat
      if (this.uploadFile) {
      if (this.uploadFile.name.endsWith('.json')) {
        fileFormat = 'json'
      } else if (this.uploadFile.name.endsWith('.csv')) {
        fileFormat = 'csv'
      } else {
        alert('未选择文件，或文件缺少名称')
        return
        }
      }
      let reader = new FileReader();
      reader.onload = (e) => {
        let rawData = e.target.result
        let data
        if (fileFormat === 'csv') {
          let result = Papa.parse(rawData, { header: true, skipEmptyLines: true, transform: (value) => value === '' ? null : value })
          if (result.errors.length) {
            alert(result.errors[0].message)
            return
          }
          data = result.data
        } else if (fileFormat === 'json') {
          try {
            data = JSON.parse(rawData)
          } catch {
            alert('JSON 文件格式无效')
            return
          }
        }
        this.predictBatch(data)
        this.showUploadModal = false;
        this.uploadFile = null;
      }
      reader.readAsText(this.uploadFile)
    },
    downloadCSV() {
      if (!this.results.length) {
        alert('没有可下载的结果。')
        return
      }
      let downloadData = Papa.unparse(this.results)
      let blob = new Blob([downloadData], { type: 'data:text/csv;charset=utf-8' })
      saveAs(blob, this.exportFileName + '.csv')
    },
    downloadJSON() {
      if (!this.results.length) {
        alert('没有可下载的结果。')
        return
      }
      let downloadData = JSON.stringify(this.results)
      let blob = new Blob([downloadData], { type: 'data:text/json;charset=utf-8' })
      saveAs(blob, this.exportFileName + '.json')
    },
  },
}
</script>

<style scoped>
:deep(.highlight-row) {
  background-color: #e0f7fa !important;
  padding: 10px !important;
  transition: background-color 0.3s ease !important;
}

:deep(.highlight-row td:first-child) {
  border-left: 4px solid #00796b;
}

.solpred-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.solpred-actions .v-btn {
  margin: 0 !important;
}

@media (max-width: 600px) {
  .solpred-actions .v-btn {
    flex: 1 1 138px;
  }
}

.v-theme--dark {
  :deep(.highlight-row td:first-child) {
    border-left: 4px solid #80cbc4;
  }

  :deep(.highlight-row) {
    background-color: #004d40 !important;
    padding: 10px !important;
    transition: background-color 0.3s ease !important;
  }
}
</style>
